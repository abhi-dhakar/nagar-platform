import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { canAccessRepository, effectiveRole } from "./repository-access.js";
import { GitStore } from "../git/git-store.js";
import {
  normalizeRepositoryPath,
  normalizeRepositorySlug,
  normalizeUsername,
} from "./validation.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const storageRoot = resolve(projectRoot, process.env.NAGAR_GIT_ROOT ?? "data/git");
const gitStore = new GitStore(storageRoot);

function failure(code: string, message: string): ApiFailure {
  return { success: false, error: { code, message } };
}

function success<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function cloneUrl(namespace: string, slug: string): string {
  const base = (process.env.NAGAR_GIT_BASE_URL ?? "http://localhost:4000/git").replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}.git`;
}

async function findReadableRepository(
  namespaceInput: string,
  slugInput: string,
  userId: string | null,
) {
  const namespace = normalizeUsername(namespaceInput);
  const slug = normalizeRepositorySlug(slugInput.replace(/\.git$/i, ""));
  if (!namespace || !slug) return null;
  const [user, organization] = await Promise.all([
    prisma.user.findUnique({ where: { username: namespace }, select: { id: true } }),
    prisma.organization.findUnique({
      where: { slug: namespace },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  if (!user && !organization) return null;
  const repository = await prisma.repository.findFirst({
    where: user ? { slug, ownerId: user.id } : { slug, organizationId: organization!.id },
    include: {
      owner: { select: { id: true, name: true, username: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!repository || !(await canAccessRepository(repository, userId))) return null;
  const owner =
    repository.owner ??
    (repository.organization
      ? {
          id: repository.organization.id,
          name: repository.organization.name,
          username: repository.organization.slug,
        }
      : null);
  if (!owner) return null;
  return {
    ...repository,
    owner,
    namespace: owner.username,
    namespaceType: repository.organizationId ? ("ORGANIZATION" as const) : ("USER" as const),
  };
}

async function repositorySummary(
  repository: NonNullable<Awaited<ReturnType<typeof findReadableRepository>>>,
  requestedBranch?: string,
) {
  const [defaultBranch, branches] = await Promise.all([
    gitStore.defaultBranch(repository.gitPath),
    gitStore.branches(repository.gitPath),
  ]);
  const branch = requestedBranch ?? defaultBranch ?? branches[0] ?? "main";
  const [files, commits] = await Promise.all([
    defaultBranch || branches.length
      ? gitStore.tree(repository.gitPath, branch)
      : Promise.resolve([]),
    defaultBranch || branches.length
      ? gitStore.commits(repository.gitPath, branch, 20)
      : Promise.resolve([]),
  ]);
  const readmeEntry = files.find(
    (entry) => /^readme(?:\.md|\.markdown)?$/i.test(entry.name) && entry.kind === "file",
  );
  const readme = readmeEntry
    ? await gitStore.textFile(repository.gitPath, branch, readmeEntry.path)
    : null;
  const {
    gitPath: _gitPath,
    ownerId: _ownerId,
    organizationId: _organizationId,
    organization: _organization,
    ...publicRepository
  } = repository;
  return {
    ...publicRepository,
    namespace: repository.namespace,
    namespaceType: repository.namespaceType,
    cloneUrl: repository.owner!.username
      ? cloneUrl(repository.owner!.username, repository.slug)
      : null,
    defaultBranch,
    branch: branches.includes(branch) ? branch : null,
    branches,
    files,
    commits,
    readme,
  };
}

export { findReadableRepository, gitStore };

export const repositoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/repositories", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    // Everything the user can work on: their own repositories, repositories they were invited
    // to, and repositories owned by organizations they belong to.
    const repositories = await prisma.repository.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
          { organization: { members: { some: { userId } } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        owner: { select: { username: true } },
        organization: {
          select: { slug: true, members: { where: { userId }, select: { role: true } } },
        },
        members: { where: { userId }, select: { role: true } },
      },
    });
    return reply.send(
      success({
        repositories: repositories.map((repository) => {
          const namespace = repository.owner?.username ?? repository.organization?.slug ?? null;
          return {
            id: repository.id,
            name: repository.name,
            slug: repository.slug,
            description: repository.description,
            visibility: repository.visibility,
            createdAt: repository.createdAt,
            updatedAt: repository.updatedAt,
            owner: namespace,
            namespace,
            namespaceType: repository.organizationId
              ? ("ORGANIZATION" as const)
              : ("USER" as const),
            role: effectiveRole({
              isOwner: repository.ownerId === userId,
              organizationRole: repository.organization?.members[0]?.role ?? null,
              collaboratorRole: repository.members[0]?.role ?? null,
            }),
            cloneUrl: namespace ? cloneUrl(namespace, repository.slug) : null,
          };
        }),
      }),
    );
  });

  app.post<{ Body: unknown }>("/api/v1/repositories", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      return reply.status(400).send(failure("INVALID_REPOSITORY", "Provide a repository object."));
    }

    const body = request.body as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug = normalizeRepositorySlug(name);
    const description = body.description === undefined ? "" : body.description;
    const visibility = body.visibility === undefined ? "PRIVATE" : body.visibility;
    if (!slug || name.length > 100) {
      return reply
        .status(400)
        .send(
          failure(
            "INVALID_REPOSITORY_NAME",
            "Use a 1–100 character repository name with letters, numbers, dots, or hyphens.",
          ),
        );
    }
    if (typeof description !== "string" || description.trim().length > 350) {
      return reply
        .status(400)
        .send(failure("INVALID_DESCRIPTION", "Description must be 350 characters or fewer."));
    }
    if (visibility !== "PUBLIC" && visibility !== "PRIVATE") {
      return reply
        .status(400)
        .send(failure("INVALID_VISIBILITY", "Visibility must be PUBLIC or PRIVATE."));
    }

    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!owner?.username) {
      return reply
        .status(409)
        .send(failure("PROFILE_REQUIRED", "Choose a username before creating a repository."));
    }

    const id = randomUUID();
    const gitPath = `${id}.git`;
    const initializeWithReadme = body.initializeWithReadme !== false;
    let metadataCreated = false;
    try {
      await gitStore.createBare(gitPath);
      if (initializeWithReadme) await gitStore.initializeReadme(gitPath, name);
      await prisma.repository.create({
        data: {
          id,
          ownerId: userId,
          name,
          slug,
          description: description.trim() || null,
          visibility,
          gitPath,
        },
      });
      metadataCreated = true;
      const summaryRepository = await findReadableRepository(owner.username, slug, userId);
      if (!summaryRepository)
        throw new Error("Created repository could not be resolved in its namespace.");
      const summary = await repositorySummary(summaryRepository);
      return reply.status(201).send(success({ repository: summary }));
    } catch (error) {
      if (metadataCreated) {
        await prisma.repository.delete({ where: { id } }).catch(() => undefined);
      }
      await gitStore.remove(gitPath).catch(() => undefined);
      if (isUniqueViolation(error)) {
        return reply
          .status(409)
          .send(failure("REPOSITORY_EXISTS", "A repository with that name already exists."));
      }
      throw error;
    }
  });

  app.get<{
    Params: { username: string; repository: string };
    Querystring: { ref?: string };
  }>("/api/v1/repositories/:username/:repository", async (request, reply) => {
    const userId = await currentUserId(request);
    const repository = await findReadableRepository(
      request.params.username,
      request.params.repository,
      userId,
    );
    if (!repository)
      return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
    const branches = await gitStore.branches(repository.gitPath);
    if (request.query.ref && !branches.includes(request.query.ref)) {
      return reply.status(404).send(failure("BRANCH_NOT_FOUND", "Branch was not found."));
    }
    return reply.send(
      success({ repository: await repositorySummary(repository, request.query.ref) }),
    );
  });

  app.get<{
    Params: { username: string; repository: string };
    Querystring: { ref?: string; path?: string };
  }>("/api/v1/repositories/:username/:repository/contents", async (request, reply) => {
    const userId = await currentUserId(request);
    const repository = await findReadableRepository(
      request.params.username,
      request.params.repository,
      userId,
    );
    if (!repository)
      return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
    const path = normalizeRepositoryPath(request.query.path);
    if (path === null)
      return reply
        .status(400)
        .send(failure("INVALID_PATH", "The requested repository path is invalid."));
    const branches = await gitStore.branches(repository.gitPath);
    const branch =
      request.query.ref ?? (await gitStore.defaultBranch(repository.gitPath)) ?? branches[0];
    if (!branch || !branches.includes(branch)) {
      return reply.status(404).send(failure("BRANCH_NOT_FOUND", "Branch was not found."));
    }
    const entries = await gitStore.tree(repository.gitPath, branch, path);
    return reply.send(success({ branch, path, entries }));
  });

  app.get<{
    Params: { username: string; repository: string };
    Querystring: { ref?: string; path: string };
  }>("/api/v1/repositories/:username/:repository/blob", async (request, reply) => {
    const userId = await currentUserId(request);
    const repository = await findReadableRepository(
      request.params.username,
      request.params.repository,
      userId,
    );
    if (!repository)
      return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
    const path = normalizeRepositoryPath(request.query.path);
    if (!path)
      return reply.status(400).send(failure("INVALID_PATH", "A valid file path is required."));
    const branches = await gitStore.branches(repository.gitPath);
    const branch =
      request.query.ref ?? (await gitStore.defaultBranch(repository.gitPath)) ?? branches[0];
    if (!branch || !branches.includes(branch)) {
      return reply.status(404).send(failure("BRANCH_NOT_FOUND", "Branch was not found."));
    }
    const blob = await gitStore.blob(repository.gitPath, branch, path);
    if (blob.status === "not_found")
      return reply.status(404).send(failure("FILE_NOT_FOUND", "File was not found."));
    if (blob.status === "binary")
      return reply.send(success({ branch, path, size: blob.size, binary: true, content: null }));
    if (blob.status === "too_large")
      return reply.send(success({ branch, path, size: blob.size, tooLarge: true, content: null }));
    return reply.send(success({ branch, path, size: blob.size, content: blob.content }));
  });
};
