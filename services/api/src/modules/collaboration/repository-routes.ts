import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { KeyedMutex } from "../../lib/keyed-mutex.js";
import { currentUserId } from "../auth/current-user.js";
import { MergeConflictError, NothingToMergeError } from "../git/git-store.js";
import { canAccessRepository, usersWithRole } from "../repositories/repository-access.js";
import { findReadableRepository, gitStore } from "../repositories/repository-routes.js";
import { dispatchRepositoryEvent, notifyRepositoryCollaborators } from "./events.js";
import { summarizeReviews, type ReviewState } from "./review-decision.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});

type RepoParams = { username: string; repository: string };
type IssueParams = RepoParams & { number: string };

const person = { id: true, name: true, username: true } as const;
/** Merges rewrite a branch, so only one may run per repository at a time. */
const mergeLock = new KeyedMutex();

function stringValue(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function issueNumber(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function readable(
  request: { params: RepoParams; headers: Record<string, string | string[] | undefined> },
  userId: string | null,
  reply: { status: (code: number) => { send: (value: unknown) => unknown } },
) {
  const repository = await findReadableRepository(
    request.params.username,
    request.params.repository,
    userId,
  );
  if (!repository) {
    reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
    return null;
  }
  return repository;
}

async function sender(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  return { id: userId, username: user?.username ?? null };
}

type ReviewedPull = {
  authorId: string;
  reviews: {
    reviewerId: string;
    state: ReviewState;
    createdAt: Date;
    reviewer: { id: string; name: string; username: string | null };
  }[];
};

/** Adds the merge decision (and who is behind it) to a pull request with its reviews loaded. */
function withDecision<T extends ReviewedPull>(
  pullRequest: T,
  eligibleReviewers: ReadonlySet<string>,
) {
  const summary = summarizeReviews(pullRequest.reviews, pullRequest.authorId, eligibleReviewers);
  const people = new Map(pullRequest.reviews.map((review) => [review.reviewerId, review.reviewer]));
  const pick = (ids: string[]) =>
    ids.flatMap((id) => {
      const reviewer = people.get(id);
      return reviewer ? [reviewer] : [];
    });
  return {
    ...pullRequest,
    reviewDecision: summary.decision,
    approvedBy: pick(summary.approvedBy),
    changesRequestedBy: pick(summary.changesRequestedBy),
  };
}

function pullPayload(pullRequest: {
  number: number;
  title: string;
  state: string;
  baseBranch: string;
  headBranch: string;
  mergeCommitSha?: string | null;
}) {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    base: pullRequest.baseBranch,
    head: pullRequest.headBranch,
    mergeCommitSha: pullRequest.mergeCommitSha ?? null,
  };
}

type MergeOutcome =
  | { ok: true; pullRequest: Awaited<ReturnType<typeof loadPull>> }
  | { ok: false; status: number; error: ApiFailure };

function loadPull(id: string) {
  return prisma.pullRequest.findUniqueOrThrow({
    where: { id },
    include: {
      author: { select: person },
      reviews: { include: { reviewer: { select: person } }, orderBy: { createdAt: "desc" } },
    },
  });
}

export const collaborationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: RepoParams; Querystring: { state?: string } }>(
    "/api/v1/repositories/:username/:repository/issues",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      const state = request.query.state === "CLOSED" ? "CLOSED" : "OPEN";
      const issues = await prisma.issue.findMany({
        where: { repositoryId: repository.id, state },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          author: { select: person },
          assignee: { select: person },
          labels: { include: { label: true } },
          _count: { select: { labels: true } },
        },
      });
      return reply.send(success({ issues }));
    },
  );

  app.get<{ Params: RepoParams }>(
    "/api/v1/repositories/:username/:repository/labels",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      const labels = await prisma.label.findMany({
        where: { repositoryId: repository.id },
        orderBy: { name: "asc" },
      });
      return reply.send(success({ labels }));
    },
  );

  app.post<{ Params: RepoParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/labels",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      if (!(await canAccessRepository(repository, userId, "WRITE")))
        return reply.status(403).send(failure("FORBIDDEN", "Write access is required."));
      const body = record(request.body);
      const name = stringValue(body?.name, 40);
      const description =
        body?.description === undefined ? null : stringValue(body.description, 200);
      const colorInput = body?.color;
      const validColor =
        colorInput === undefined ||
        (typeof colorInput === "string" && /^#?[\da-fA-F]{6}$/.test(colorInput));
      if (
        !name ||
        !/^[\p{L}\p{N} _.-]+$/u.test(name) ||
        (body?.description !== undefined && description === null)
      ) {
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_LABEL",
              "Provide a valid label name and an optional description up to 200 characters.",
            ),
          );
      }
      if (!validColor)
        return reply
          .status(400)
          .send(
            failure("INVALID_LABEL_COLOR", "Label color must be a 6-digit hex value like D73A4A."),
          );
      const color =
        typeof colorInput === "string" ? colorInput.replace(/^#/, "").toUpperCase() : "FFD93D";
      // "Bug" and "bug" are the same label to a person, so compare case-insensitively.
      const existing = await prisma.label.findFirst({
        where: { repositoryId: repository.id, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing)
        return reply
          .status(409)
          .send(failure("LABEL_EXISTS", "A label with that name already exists."));
      try {
        const label = await prisma.label.create({
          data: { id: randomUUID(), repositoryId: repository.id, name, color, description },
        });
        return reply.status(201).send(success({ label }));
      } catch (error) {
        if (isUniqueViolation(error))
          return reply
            .status(409)
            .send(failure("LABEL_EXISTS", "A label with that name already exists."));
        throw error;
      }
    },
  );

  app.post<{ Params: RepoParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/issues",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      if (!(await canAccessRepository(repository, userId, "READ")))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Repository access is required to open an issue."));
      const body = record(request.body);
      const title = stringValue(body?.title, 180);
      const text = body?.body === undefined ? "" : stringValue(body.body, 20_000);
      const labelIds =
        Array.isArray(body?.labelIds) && body.labelIds.every((id) => typeof id === "string")
          ? [...new Set(body.labelIds as string[])]
          : [];
      if (!title || (body?.body !== undefined && text === null) || labelIds.length > 10)
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_ISSUE",
              "Title is required; issue body is limited to 20,000 characters and at most 10 labels.",
            ),
          );
      if (
        labelIds.length &&
        (await prisma.label.count({
          where: { id: { in: labelIds }, repositoryId: repository.id },
        })) !== labelIds.length
      )
        return reply
          .status(400)
          .send(failure("INVALID_LABELS", "One or more labels do not belong to this repository."));
      const issue = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "repository" WHERE "id" = ${repository.id} FOR UPDATE`;
        const current =
          (
            await tx.issue.aggregate({
              where: { repositoryId: repository.id },
              _max: { number: true },
            })
          )._max.number ?? 0;
        return tx.issue.create({
          data: {
            id: randomUUID(),
            number: current + 1,
            title,
            body: text ?? "",
            repositoryId: repository.id,
            authorId: userId,
            ...(labelIds.length
              ? {
                  labels: {
                    create: labelIds.map((labelId) => ({ label: { connect: { id: labelId } } })),
                  },
                }
              : {}),
          },
          include: {
            author: { select: person },
            labels: { include: { label: true } },
          },
        });
      });
      const url = `/${repository.namespace}/${repository.slug}/issues`;
      await notifyRepositoryCollaborators({
        repositoryId: repository.id,
        ownerId: repository.ownerId,
        organizationId: repository.organizationId,
        actorId: userId,
        type: "ISSUE_OPENED",
        title: `New issue #${issue.number}`,
        body: issue.title,
        url,
      });
      dispatchRepositoryEvent(repository.id, "issues.opened", {
        issue: { number: issue.number, title: issue.title, state: issue.state },
        repository: { name: repository.slug, owner: repository.namespace },
        sender: await sender(userId),
      });
      return reply.status(201).send(success({ issue }));
    },
  );

  app.patch<{ Params: IssueParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/issues/:number",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      const number = issueNumber(request.params.number);
      const body = record(request.body);
      if (!number || !body)
        return reply.status(400).send(failure("INVALID_ISSUE", "Provide a valid issue update."));
      const issue = await prisma.issue.findUnique({
        where: { repositoryId_number: { repositoryId: repository.id, number } },
      });
      if (!issue) return reply.status(404).send(failure("ISSUE_NOT_FOUND", "Issue was not found."));
      // Maintainers manage any issue; people with read access can edit or close their own.
      const isWriter = await canAccessRepository(repository, userId, "WRITE");
      if (!isWriter && issue.authorId !== userId)
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Write access is required to change someone else's issue."));
      const update: {
        title?: string;
        body?: string;
        state?: "OPEN" | "CLOSED";
        closedAt?: Date | null;
      } = {};
      if (body.title !== undefined) {
        const title = stringValue(body.title, 180);
        if (!title)
          return reply
            .status(400)
            .send(
              failure("INVALID_TITLE", "Issue title is required and limited to 180 characters."),
            );
        update.title = title;
      }
      if (body.body !== undefined) {
        const text = stringValue(body.body, 20_000);
        if (text === null)
          return reply
            .status(400)
            .send(failure("INVALID_BODY", "Issue body is limited to 20,000 characters."));
        update.body = text;
      }
      if (body.state !== undefined) {
        if (body.state !== "OPEN" && body.state !== "CLOSED")
          return reply
            .status(400)
            .send(failure("INVALID_STATE", "Issue state must be OPEN or CLOSED."));
        update.state = body.state;
        update.closedAt = body.state === "CLOSED" ? new Date() : null;
      }
      const labelIds =
        body.labelIds === undefined
          ? null
          : Array.isArray(body.labelIds) && body.labelIds.every((id) => typeof id === "string")
            ? [...new Set(body.labelIds as string[])]
            : [];
      if (labelIds && !isWriter)
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Write access is required to change labels."));
      if (labelIds && labelIds.length > 10)
        return reply.status(400).send(failure("INVALID_LABELS", "Choose no more than 10 labels."));
      if (
        labelIds?.length &&
        (await prisma.label.count({
          where: { id: { in: labelIds }, repositoryId: repository.id },
        })) !== labelIds.length
      )
        return reply
          .status(400)
          .send(failure("INVALID_LABELS", "One or more labels do not belong to this repository."));
      const updated = await prisma.$transaction(async (tx) => {
        if (labelIds) await tx.issueLabel.deleteMany({ where: { issueId: issue.id } });
        return tx.issue.update({
          where: { id: issue.id },
          data: {
            ...update,
            ...(labelIds ? { labels: { create: labelIds.map((labelId) => ({ labelId })) } } : {}),
          },
          include: {
            author: { select: person },
            labels: { include: { label: true } },
          },
        });
      });
      if (update.state && update.state !== issue.state) {
        const event = update.state === "CLOSED" ? "issues.closed" : "issues.reopened";
        const url = `/${repository.namespace}/${repository.slug}/issues`;
        await notifyRepositoryCollaborators({
          repositoryId: repository.id,
          ownerId: repository.ownerId,
          organizationId: repository.organizationId,
          actorId: userId,
          type: update.state === "CLOSED" ? "ISSUE_CLOSED" : "ISSUE_REOPENED",
          title: `Issue #${number} ${update.state.toLowerCase()}`,
          body: updated.title,
          url,
          extraRecipientIds: [issue.authorId],
        });
        dispatchRepositoryEvent(repository.id, event, {
          issue: { number, title: updated.title, state: updated.state },
          repository: { name: repository.slug, owner: repository.namespace },
          sender: await sender(userId),
        });
      }
      return reply.send(success({ issue: updated }));
    },
  );

  app.get<{ Params: RepoParams }>(
    "/api/v1/repositories/:username/:repository/pulls",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      const pullRequests = await prisma.pullRequest.findMany({
        where: { repositoryId: repository.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          author: { select: person },
          reviews: { include: { reviewer: { select: person } }, orderBy: { createdAt: "desc" } },
        },
      });
      const eligible = await usersWithRole(
        repository,
        pullRequests.flatMap((pull) => pull.reviews.map((review) => review.reviewerId)),
        "WRITE",
      );
      return reply.send(
        success({
          pullRequests: pullRequests.map((pull) => withDecision(pull, eligible)),
          branches: await gitStore.branches(repository.gitPath),
        }),
      );
    },
  );

  app.get<{ Params: IssueParams }>(
    "/api/v1/repositories/:username/:repository/pulls/:number",
    async (request, reply) => {
      const userId = await currentUserId(request);
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      const number = issueNumber(request.params.number);
      if (!number)
        return reply
          .status(404)
          .send(failure("PULL_REQUEST_NOT_FOUND", "Pull request was not found."));
      const pullRequest = await prisma.pullRequest.findUnique({
        where: { repositoryId_number: { repositoryId: repository.id, number } },
        include: {
          author: { select: person },
          reviews: { include: { reviewer: { select: person } }, orderBy: { createdAt: "desc" } },
        },
      });
      if (!pullRequest)
        return reply
          .status(404)
          .send(failure("PULL_REQUEST_NOT_FOUND", "Pull request was not found."));
      const eligible = await usersWithRole(
        repository,
        pullRequest.reviews.map((review) => review.reviewerId),
        "WRITE",
      );
      // Open PRs show what the branch would add now. A merged PR shows what its merge brought in
      // (the merge commit's two parents), because the base already contains the branch.
      let comparison = null;
      if (pullRequest.state === "MERGED" && pullRequest.mergeCommitSha) {
        const parents = await gitStore.parents(repository.gitPath, pullRequest.mergeCommitSha);
        if (parents && parents.length >= 2 && parents[0] && parents[1])
          comparison = await gitStore.compare(repository.gitPath, parents[0], parents[1]);
      } else {
        comparison = await gitStore.compare(
          repository.gitPath,
          pullRequest.baseBranch,
          pullRequest.headBranch,
        );
      }
      return reply.send(success({ pullRequest: withDecision(pullRequest, eligible), comparison }));
    },
  );

  app.post<{ Params: RepoParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/pulls",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      if (!(await canAccessRepository(repository, userId, "WRITE")))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Write access is required to open a pull request."));
      const body = record(request.body);
      const title = stringValue(body?.title, 180);
      const text = body?.body === undefined ? "" : stringValue(body.body, 20_000);
      const baseBranch = stringValue(body?.baseBranch, 120);
      const headBranch = stringValue(body?.headBranch, 120);
      const branches = await gitStore.branches(repository.gitPath);
      if (!title || text === null || !baseBranch || !headBranch || baseBranch === headBranch)
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_PULL_REQUEST",
              "Provide a title, different base/head branches, and a body under 20,000 characters.",
            ),
          );
      if (!branches.includes(baseBranch) || !branches.includes(headBranch))
        return reply
          .status(400)
          .send(failure("INVALID_BRANCH", "Both branches must exist in this repository."));
      const comparison = await gitStore.compare(repository.gitPath, baseBranch, headBranch);
      if (comparison && comparison.ahead === 0)
        return reply
          .status(400)
          .send(
            failure(
              "NO_CHANGES",
              "The compare branch has no commits that are not already in the base branch.",
            ),
          );
      const duplicate = await prisma.pullRequest.findFirst({
        where: { repositoryId: repository.id, headBranch, baseBranch, state: "OPEN" },
      });
      if (duplicate)
        return reply
          .status(409)
          .send(
            failure(
              "PULL_REQUEST_EXISTS",
              "An open pull request already exists for these branches.",
            ),
          );
      const pullRequest = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "repository" WHERE "id" = ${repository.id} FOR UPDATE`;
        const current =
          (
            await tx.pullRequest.aggregate({
              where: { repositoryId: repository.id },
              _max: { number: true },
            })
          )._max.number ?? 0;
        return tx.pullRequest.create({
          data: {
            id: randomUUID(),
            number: current + 1,
            title,
            body: text,
            baseBranch,
            headBranch,
            repositoryId: repository.id,
            authorId: userId,
          },
          include: { author: { select: person }, reviews: true },
        });
      });
      await notifyRepositoryCollaborators({
        repositoryId: repository.id,
        ownerId: repository.ownerId,
        organizationId: repository.organizationId,
        actorId: userId,
        type: "PULL_REQUEST_OPENED",
        title: `New pull request #${pullRequest.number}`,
        body: pullRequest.title,
        url: `/${repository.namespace}/${repository.slug}/pulls`,
      });
      dispatchRepositoryEvent(repository.id, "pull_request.opened", {
        pullRequest: pullPayload(pullRequest),
        repository: { name: repository.slug, owner: repository.namespace },
        sender: await sender(userId),
      });
      return reply.status(201).send(success({ pullRequest }));
    },
  );

  app.patch<{ Params: IssueParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/pulls/:number",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      if (!(await canAccessRepository(repository, userId, "WRITE")))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Write access is required to update a pull request."));
      const number = issueNumber(request.params.number);
      const body = record(request.body);
      const state = body?.state;
      if (!number || (state !== "CLOSED" && state !== "MERGED"))
        return reply
          .status(400)
          .send(failure("INVALID_STATE", "Pull request state must be CLOSED or MERGED."));
      const pullRequest = await prisma.pullRequest.findUnique({
        where: { repositoryId_number: { repositoryId: repository.id, number } },
        select: { id: true },
      });
      if (!pullRequest)
        return reply
          .status(404)
          .send(failure("PULL_REQUEST_NOT_FOUND", "Pull request was not found."));

      // Everything that changes a pull request's state runs under the repository's merge lock,
      // so two requests cannot both merge (or merge and close) the same pull request.
      const outcome = await mergeLock.run(repository.id, async (): Promise<MergeOutcome> => {
        const current = await prisma.pullRequest.findUnique({
          where: { id: pullRequest.id },
          include: { reviews: { select: { reviewerId: true, state: true, createdAt: true } } },
        });
        if (!current || current.state !== "OPEN")
          return {
            ok: false,
            status: 409,
            error: failure("PULL_REQUEST_CLOSED", "This pull request is already closed."),
          };
        let mergeCommitSha: string | undefined;
        if (state === "MERGED") {
          const eligible = await usersWithRole(
            repository,
            current.reviews.map((review) => review.reviewerId),
            "WRITE",
          );
          const { decision } = summarizeReviews(current.reviews, current.authorId, eligible);
          if (decision === "CHANGES_REQUESTED")
            return {
              ok: false,
              status: 409,
              error: failure(
                "CHANGES_REQUESTED",
                "A reviewer has requested changes. They must approve before this can merge.",
              ),
            };
          if (decision !== "APPROVED")
            return {
              ok: false,
              status: 409,
              error: failure(
                "APPROVAL_REQUIRED",
                "At least one approval from a collaborator with write access is required to merge.",
              ),
            };
          try {
            mergeCommitSha = await gitStore.mergeBranches(
              repository.gitPath,
              current.baseBranch,
              current.headBranch,
            );
          } catch (error) {
            if (error instanceof MergeConflictError)
              return {
                ok: false,
                status: 409,
                error: failure(
                  "MERGE_CONFLICT",
                  "The branches could not be merged cleanly. Resolve conflicts and push an updated branch first.",
                ),
              };
            if (error instanceof NothingToMergeError)
              return {
                ok: false,
                status: 409,
                error: failure(
                  "NOTHING_TO_MERGE",
                  "The base branch already contains every commit from this branch. Close the pull request instead.",
                ),
              };
            request.log.error(
              { err: error, repositoryId: repository.id, pullRequest: number },
              "Pull request merge failed",
            );
            return {
              ok: false,
              status: 500,
              error: failure("MERGE_FAILED", "The merge could not be completed. Try again."),
            };
          }
        }
        const changed = await prisma.pullRequest.updateMany({
          where: { id: current.id, state: "OPEN" },
          data: { state, closedAt: new Date(), ...(mergeCommitSha ? { mergeCommitSha } : {}) },
        });
        if (changed.count === 0)
          return {
            ok: false,
            status: 409,
            error: failure("PULL_REQUEST_CLOSED", "This pull request is already closed."),
          };
        return { ok: true, pullRequest: await loadPull(current.id) };
      });
      if (!outcome.ok) return reply.status(outcome.status).send(outcome.error);

      const updated = outcome.pullRequest;
      if (updated.authorId !== userId) {
        await prisma.notification.create({
          data: {
            id: randomUUID(),
            userId: updated.authorId,
            type: `PULL_REQUEST_${state}`,
            title: `Pull request #${number} ${state.toLowerCase()}`,
            body: updated.title,
            url: `/${repository.namespace}/${repository.slug}/pulls`,
          },
        });
      }
      dispatchRepositoryEvent(
        repository.id,
        state === "MERGED" ? "pull_request.merged" : "pull_request.closed",
        {
          pullRequest: pullPayload(updated),
          repository: { name: repository.slug, owner: repository.namespace },
          sender: await sender(userId),
        },
      );
      const eligible = await usersWithRole(
        repository,
        updated.reviews.map((review) => review.reviewerId),
        "WRITE",
      );
      return reply.send(success({ pullRequest: withDecision(updated, eligible) }));
    },
  );

  app.post<{ Params: IssueParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/pulls/:number/reviews",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await readable(request, userId, reply);
      if (!repository) return;
      if (!(await canAccessRepository(repository, userId, "READ")))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Repository access is required to review."));
      const number = issueNumber(request.params.number);
      const body = record(request.body);
      const text = body?.body === undefined ? "" : stringValue(body.body, 10_000);
      const state = body?.state;
      if (
        !number ||
        !body ||
        !["APPROVED", "COMMENTED", "CHANGES_REQUESTED"].includes(String(state)) ||
        text === null
      )
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_REVIEW",
              "Choose approved, commented, or changes requested and provide a comment up to 10,000 characters.",
            ),
          );
      // Anyone who can read the repository may comment, but a verdict that gates the merge has
      // to come from someone allowed to merge.
      if (state !== "COMMENTED" && !(await canAccessRepository(repository, userId, "WRITE")))
        return reply
          .status(403)
          .send(
            failure(
              "FORBIDDEN",
              "Write access is required to approve or request changes. You can still leave a comment.",
            ),
          );
      const pullRequest = await prisma.pullRequest.findUnique({
        where: { repositoryId_number: { repositoryId: repository.id, number } },
      });
      if (!pullRequest)
        return reply
          .status(404)
          .send(failure("PULL_REQUEST_NOT_FOUND", "Pull request was not found."));
      if (pullRequest.state !== "OPEN")
        return reply
          .status(409)
          .send(failure("PULL_REQUEST_CLOSED", "Closed pull requests cannot be reviewed."));
      if (pullRequest.authorId === userId)
        return reply
          .status(403)
          .send(failure("SELF_REVIEW", "You cannot review your own pull request."));
      const review = await prisma.pullRequestReview.create({
        data: {
          id: randomUUID(),
          pullRequestId: pullRequest.id,
          reviewerId: userId,
          state: state as ReviewState,
          body: text,
        },
        include: { reviewer: { select: person } },
      });
      await prisma.notification.create({
        data: {
          id: randomUUID(),
          userId: pullRequest.authorId,
          type: "PULL_REQUEST_REVIEW",
          title: `Review on pull request #${number}`,
          body: `${review.reviewer.name}: ${review.state.replaceAll("_", " ")}`,
          url: `/${repository.namespace}/${repository.slug}/pulls`,
        },
      });
      dispatchRepositoryEvent(repository.id, "pull_request.reviewed", {
        pullRequest: pullPayload(pullRequest),
        review: { state: review.state, body: review.body },
        repository: { name: repository.slug, owner: repository.namespace },
        sender: await sender(userId),
      });
      return reply.status(201).send(success({ review }));
    },
  );
};
