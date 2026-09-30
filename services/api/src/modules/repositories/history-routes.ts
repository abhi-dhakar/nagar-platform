import type { ApiFailure, ApiSuccess } from "@nagar/types";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { findReadableRepository, gitStore } from "./repository-routes.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});

type RepoParams = { username: string; repository: string };

function positiveInteger(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined || value === "") return fallback;
  const number = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 1 && number <= maximum ? number : null;
}

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: RepoParams; Querystring: { ref?: string; page?: string; perPage?: string } }>(
    "/api/v1/repositories/:username/:repository/commits",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      const page = positiveInteger(request.query.page, 1, 100_000);
      const perPage = positiveInteger(request.query.perPage, 30, 100);
      if (page === null || perPage === null)
        return reply
          .status(400)
          .send(failure("INVALID_PAGINATION", "page must be 1 or more and perPage 1–100."));
      const [branches, defaultBranch] = await Promise.all([
        gitStore.branches(repository.gitPath),
        gitStore.defaultBranch(repository.gitPath),
      ]);
      if (!branches.length) {
        // An empty repository has no history yet. HEAD already names "main", but no branch
        // exists until the first push, so this is a valid, empty answer rather than a 404.
        return reply.send(
          success({ ref: null, page, perPage, total: 0, hasMore: false, commits: [] }),
        );
      }
      const ref =
        request.query.ref ??
        (defaultBranch && branches.includes(defaultBranch) ? defaultBranch : branches[0]);
      if (!ref || !branches.includes(ref))
        return reply.status(404).send(failure("BRANCH_NOT_FOUND", "Branch was not found."));
      const [{ commits, hasMore }, total] = await Promise.all([
        gitStore.commitPage(repository.gitPath, ref, {
          skip: (page - 1) * perPage,
          limit: perPage,
        }),
        gitStore.countCommits(repository.gitPath, ref),
      ]);
      return reply.send(success({ ref, page, perPage, total, hasMore, commits }));
    },
  );

  app.get<{ Params: RepoParams }>(
    "/api/v1/repositories/:username/:repository/branches",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      const [defaultBranch, branches] = await Promise.all([
        gitStore.defaultBranch(repository.gitPath),
        gitStore.branchDetails(repository.gitPath),
      ]);
      return reply.send(success({ defaultBranch, branches }));
    },
  );

  app.get<{ Params: RepoParams; Querystring: { base?: string; head?: string } }>(
    "/api/v1/repositories/:username/:repository/compare",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      const { base, head } = request.query;
      if (!base || !head || typeof base !== "string" || typeof head !== "string")
        return reply
          .status(400)
          .send(failure("INVALID_COMPARISON", "Provide both base and head branches."));
      const comparison = await gitStore.compare(repository.gitPath, base, head);
      if (!comparison)
        return reply
          .status(404)
          .send(failure("BRANCH_NOT_FOUND", "Both branches must exist in this repository."));
      return reply.send(success({ comparison }));
    },
  );
};
