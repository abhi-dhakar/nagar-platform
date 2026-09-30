import { prisma } from "@nagar/database";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { ApiFailure } from "@nagar/types";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { repositoryRole } from "../repositories/repository-access.js";
import { gitStore } from "../repositories/repository-routes.js";
import { normalizeRepositorySlug, normalizeUsername } from "../repositories/validation.js";
import { runGitHttpBackend } from "./git-http.js";
import { publishPushEvents } from "./push-events.js";

interface GitParams {
  username: string;
  repository: string;
  "*": string;
}

function failure(code: string, message: string): ApiFailure {
  return { success: false, error: { code, message } };
}

function unauthorized(reply: FastifyReply) {
  return reply
    .header("www-authenticate", 'Basic realm="Nagar Git", charset="UTF-8"')
    .status(401)
    .send(failure("GIT_AUTH_REQUIRED", "Authenticate with your Nagar email and password."));
}

const failedAttempts = new Map<string, { count: number; resetAt: number }>();
let dummyHash: Promise<string> | undefined;

function isRateLimited(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= 12;
}

function recordFailure(ip: string): void {
  if (!failedAttempts.has(ip) && failedAttempts.size >= 5_000) {
    const oldest = failedAttempts.keys().next().value;
    if (oldest) failedAttempts.delete(oldest);
  }
  const now = Date.now();
  const current = failedAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    current.count += 1;
  }
}

async function basicUserId(request: FastifyRequest): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) return null;
  if (isRateLimited(request.ip)) return null;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) {
    recordFailure(request.ip);
    return null;
  }
  const email = decoded.slice(0, colon).trim().toLowerCase();
  const password = decoded.slice(colon + 1);
  const account = await prisma.account.findFirst({
    where: { providerId: "credential", user: { email } },
    select: { userId: true, password: true },
  });
  dummyHash ??= hashPassword("nagar-invalid-git-password-check");
  const valid = await verifyPassword({ hash: account?.password ?? (await dummyHash), password });
  if (!account?.password || !valid) {
    recordFailure(request.ip);
    return null;
  }
  failedAttempts.delete(request.ip);
  return account.userId;
}

async function requestUserId(request: FastifyRequest): Promise<string | null> {
  const sessionUserId = await currentUserId(request);
  if (sessionUserId) return sessionUserId;
  return basicUserId(request);
}

function isWriteOperation(
  method: string,
  tail: string,
  service: string | null,
  contentType: string | undefined,
) {
  return (
    tail === "git-receive-pack" ||
    (tail === "info/refs" && service === "git-receive-pack") ||
    (method === "POST" && contentType?.startsWith("application/x-git-receive-pack-request"))
  );
}

export const gitRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    ["application/x-git-upload-pack-request", "application/x-git-receive-pack-request"],
    { parseAs: "buffer", bodyLimit: 64 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  app.route<{ Params: GitParams; Body: Buffer }>({
    method: ["GET", "POST"],
    url: "/git/:username/:repository/*",
    bodyLimit: 64 * 1024 * 1024,
    async handler(request, reply) {
      const username = normalizeUsername(request.params.username);
      const repositoryPart = request.params.repository;
      if (!username || !repositoryPart.toLowerCase().endsWith(".git")) {
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      }
      const slug = normalizeRepositorySlug(repositoryPart.slice(0, -4));
      if (!slug)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));

      const tail = request.params["*"];
      if (!tail || tail.split("/").some((part) => !part || part === "." || part === "..")) {
        return reply.status(404).send(failure("GIT_PATH_NOT_FOUND", "Git endpoint was not found."));
      }
      const [personalOwner, organizationOwner] = await Promise.all([
        prisma.user.findUnique({ where: { username }, select: { id: true } }),
        prisma.organization.findUnique({ where: { slug: username }, select: { id: true } }),
      ]);
      const repositoryRecord = await prisma.repository.findFirst({
        where: personalOwner
          ? { slug, ownerId: personalOwner.id }
          : organizationOwner
            ? { slug, organizationId: organizationOwner.id }
            : { slug, id: "__missing__" },
        select: { id: true, ownerId: true, organizationId: true, visibility: true, gitPath: true },
      });
      if (!repositoryRecord) {
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      }

      const requestUrl = new URL(request.url, "http://nagar.local");
      const service = requestUrl.searchParams.get("service");
      const isWrite = isWriteOperation(
        request.method,
        tail,
        service,
        request.headers["content-type"],
      );
      const needsAuthentication = repositoryRecord.visibility === "PRIVATE" || isWrite;
      let userId: string | null = null;
      if (needsAuthentication || request.headers.authorization) {
        userId = await requestUserId(request);
        if (!userId && needsAuthentication) return unauthorized(reply);
        if (!userId && request.headers.authorization) return unauthorized(reply);
      }
      const role = await repositoryRole(
        repositoryRecord.id,
        repositoryRecord.ownerId,
        repositoryRecord.organizationId,
        userId,
      );
      if (isWrite && (!role || role === "READ")) {
        return reply
          .status(userId ? 403 : 401)
          .send(
            failure(
              userId ? "GIT_WRITE_FORBIDDEN" : "GIT_AUTH_REQUIRED",
              "Repository write access is required to push.",
            ),
          );
      }
      if (repositoryRecord.visibility === "PRIVATE" && !role) return unauthorized(reply);

      // Only the POST that carries the pack can change refs. The preceding
      // `info/refs?service=git-receive-pack` request is just the authenticated advertisement.
      const isPush = request.method === "POST" && tail === "git-receive-pack";
      try {
        const refsBefore = isPush
          ? await gitStore.refSnapshot(repositoryRecord.gitPath).catch(() => null)
          : null;
        const backend = await runGitHttpBackend({
          method: request.method,
          url: request.url,
          pathInfo: `/${repositoryRecord.gitPath}/${tail}`,
          projectRoot: gitStore.root,
          headers: request.headers,
          ...(Buffer.isBuffer(request.body) ? { body: request.body } : {}),
          remoteAddress: request.ip,
          ...(userId ? { remoteUser: userId } : {}),
        });
        if (isPush && refsBefore && backend.statusCode >= 200 && backend.statusCode < 300) {
          // A 2xx response can still mean "every ref update was rejected", so compare real refs.
          const refsAfter = await gitStore.refSnapshot(repositoryRecord.gitPath).catch(() => null);
          if (refsAfter) {
            const pusher = userId
              ? await prisma.user
                  .findUnique({ where: { id: userId }, select: { username: true } })
                  .catch(() => null)
              : null;
            const changed = await publishPushEvents(
              gitStore,
              {
                repositoryId: repositoryRecord.id,
                storageKey: repositoryRecord.gitPath,
                repository: { name: slug, owner: username },
                pusher: { id: userId, username: pusher?.username ?? null },
              },
              refsBefore,
              refsAfter,
            ).catch((error: unknown) => {
              request.log.warn({ err: error }, "Could not publish push events");
              return 0;
            });
            if (changed > 0) {
              await prisma.repository
                .update({ where: { id: repositoryRecord.id }, data: { updatedAt: new Date() } })
                .catch((error: unknown) =>
                  request.log.warn({ err: error }, "Could not refresh repository activity time"),
                );
            }
          }
        }
        reply.status(backend.statusCode);
        for (const [name, value] of backend.headers) reply.header(name, value);
        return reply.send(backend.body);
      } catch (error) {
        request.log.error(
          { err: error, repositoryId: repositoryRecord.id },
          "Git HTTP request failed",
        );
        return reply
          .status(500)
          .send(failure("GIT_BACKEND_ERROR", "Git request could not be completed."));
      }
    },
  });
};
