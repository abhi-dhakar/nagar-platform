import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import type { FastifyPluginAsync } from "fastify";
import { isReservedNamespace } from "../../lib/reserved-names.js";
import { currentUserId } from "../auth/current-user.js";
import { normalizeUsername, stringField } from "../repositories/validation.js";

function failure(code: string, message: string): ApiFailure {
  return { success: false, error: { code, message } };
}

function success<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { username: string } }>("/api/v1/users/:username", async (request, reply) => {
    const username = normalizeUsername(request.params.username);
    if (!username) return reply.status(404).send(failure("USER_NOT_FOUND", "User was not found."));

    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        createdAt: true,
        repositories: {
          where: { visibility: "PUBLIC" },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: { id: true, name: true, slug: true, description: true, updatedAt: true },
        },
      },
    });
    if (!user) return reply.status(404).send(failure("USER_NOT_FOUND", "User was not found."));
    return reply.send(success({ user }));
  });

  app.patch<{ Body: unknown }>("/api/v1/me/profile", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      return reply.status(400).send(failure("INVALID_PROFILE", "Provide a profile object."));
    }

    const body = request.body as Record<string, unknown>;
    const username = body.username === undefined ? undefined : normalizeUsername(body.username);
    const name = body.name === undefined ? undefined : stringField(body.name, 80);
    const bio = body.bio === undefined ? undefined : stringField(body.bio, 280);
    if (
      (body.username !== undefined && typeof username !== "string") ||
      (body.name !== undefined && (typeof name !== "string" || !name.length)) ||
      (body.bio !== undefined && typeof bio !== "string")
    ) {
      return reply
        .status(400)
        .send(failure("INVALID_PROFILE", "Check username, name, and bio lengths and formats."));
    }
    if (username && isReservedNamespace(username)) {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      // Only block *claiming* a reserved name; an account that already holds it keeps working.
      if (current?.username !== username) {
        return reply
          .status(409)
          .send(
            failure(
              "NAMESPACE_RESERVED",
              "That name is reserved by NagarHub. Please choose another username.",
            ),
          );
      }
    }
    if (
      username &&
      (await prisma.organization.findUnique({ where: { slug: username }, select: { id: true } }))
    ) {
      return reply
        .status(409)
        .send(failure("USERNAME_TAKEN", "That namespace is already used by an organization."));
    }
    if (username === undefined && name === undefined && bio === undefined) {
      return reply
        .status(400)
        .send(failure("EMPTY_PROFILE", "Provide at least one profile field."));
    }

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(typeof username === "string" ? { username } : {}),
          ...(typeof name === "string" ? { name } : {}),
          ...(typeof bio === "string" ? { bio: bio || null } : {}),
        },
        select: { id: true, name: true, username: true, bio: true, createdAt: true },
      });
      return reply.send(success({ user }));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply
          .status(409)
          .send(failure("USERNAME_TAKEN", "That username is already in use."));
      }
      throw error;
    }
  });
};
