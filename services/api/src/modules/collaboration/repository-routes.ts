import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { canAccessRepository } from "../repositories/repository-access.js";
import { findReadableRepository, gitStore } from "../repositories/repository-routes.js";
import { dispatchRepositoryEvent, notifyRepositoryCollaborators } from "./events.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});

type RepoParams = { username: string; repository: string };
type IssueParams = RepoParams & { number: string };

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
          author: { select: { id: true, name: true, username: true } },
          assignee: { select: { id: true, name: true, username: true } },
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
      const color =
        typeof body?.color === "string" && /^[\da-fA-F]{6}$/.test(body.color)
          ? body.color.toUpperCase()
          : "FFD93D";
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
      try {
        const label = await prisma.label.create({
          data: { id: randomUUID(), repositoryId: repository.id, name, color, description },
        });
        return reply.status(201).send(success({ label }));
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
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
            author: { select: { id: true, name: true, username: true } },
            labels: { include: { label: true } },
          },
        });
      });
      const url = `/${repository.owner.username}/${repository.slug}/issues`;
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
        repository: { name: repository.slug, owner: repository.owner.username },
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
      if (!(await canAccessRepository(repository, userId, "WRITE")))
        return reply.status(403).send(failure("FORBIDDEN", "Write access is required."));
      const number = issueNumber(request.params.number);
      const body = record(request.body);
      if (!number || !body)
        return reply.status(400).send(failure("INVALID_ISSUE", "Provide a valid issue update."));
      const issue = await prisma.issue.findUnique({
        where: { repositoryId_number: { repositoryId: repository.id, number } },
      });
      if (!issue) return reply.status(404).send(failure("ISSUE_NOT_FOUND", "Issue was not found."));
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
            author: { select: { id: true, name: true, username: true } },
            labels: { include: { label: true } },
          },
        });
      });
      if (update.state && update.state !== issue.state) {
        const event = update.state === "CLOSED" ? "issues.closed" : "issues.reopened";
        const url = `/${repository.namespace ?? request.params.username}/${repository.slug}/issues`;
        await notifyRepositoryCollaborators({
          repositoryId: repository.id,
          ownerId: repository.ownerId,
          organizationId: repository.organizationId,
          actorId: userId,
          type: update.state === "CLOSED" ? "ISSUE_CLOSED" : "ISSUE_REOPENED",
          title: `Issue #${number} ${update.state.toLowerCase()}`,
          body: updated.title,
          url,
        });
        dispatchRepositoryEvent(repository.id, event, {
          issue: { number, title: updated.title, state: updated.state },
          repository: { name: repository.slug, owner: repository.namespace },
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
          author: { select: { id: true, name: true, username: true } },
          reviews: {
            include: { reviewer: { select: { id: true, name: true, username: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      return reply.send(
        success({ pullRequests, branches: await gitStore.branches(repository.gitPath) }),
      );
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
          include: { author: { select: { id: true, name: true, username: true } }, reviews: true },
        });
      });
      const url = `/${repository.owner.username}/${repository.slug}/pulls`;
      await notifyRepositoryCollaborators({
        repositoryId: repository.id,
        ownerId: repository.ownerId,
        organizationId: repository.organizationId,
        actorId: userId,
        type: "PULL_REQUEST_OPENED",
        title: `New pull request #${pullRequest.number}`,
        body: pullRequest.title,
        url,
      });
      dispatchRepositoryEvent(repository.id, "pull_request.opened", {
        pullRequest: {
          number: pullRequest.number,
          title: pullRequest.title,
          base: baseBranch,
          head: headBranch,
        },
        repository: { name: repository.slug, owner: repository.owner.username },
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
      });
      if (!pullRequest)
        return reply
          .status(404)
          .send(failure("PULL_REQUEST_NOT_FOUND", "Pull request was not found."));
      if (pullRequest.state !== "OPEN")
        return reply
          .status(409)
          .send(failure("PULL_REQUEST_CLOSED", "This pull request is already closed."));
      let mergeCommitSha: string | undefined;
      if (state === "MERGED") {
        const latestReview = await prisma.pullRequestReview.findFirst({
          where: { pullRequestId: pullRequest.id, reviewerId: { not: pullRequest.authorId } },
          orderBy: { createdAt: "desc" },
          select: { state: true },
        });
        if (latestReview?.state !== "APPROVED")
          return reply
            .status(409)
            .send(
              failure("APPROVAL_REQUIRED", "The latest review must be an approval before merging."),
            );
        try {
          mergeCommitSha = await gitStore.mergeBranches(
            repository.gitPath,
            pullRequest.baseBranch,
            pullRequest.headBranch,
          );
        } catch (error) {
          request.log.info(
            { err: error, repositoryId: repository.id, pullRequest: number },
            "Pull request merge was rejected",
          );
          return reply
            .status(409)
            .send(
              failure(
                "MERGE_CONFLICT",
                "The branches could not be merged cleanly. Resolve conflicts and push an updated branch first.",
              ),
            );
        }
      }
      const updated = await prisma.pullRequest.update({
        where: { id: pullRequest.id },
        data: { state, closedAt: new Date(), ...(mergeCommitSha ? { mergeCommitSha } : {}) },
        include: { author: { select: { id: true, name: true, username: true } } },
      });
      await prisma.notification.create({
        data: {
          id: randomUUID(),
          userId: pullRequest.authorId,
          type: `PULL_REQUEST_${state}`,
          title: `Pull request #${number} ${state.toLowerCase()}`,
          body: updated.title,
          url: `/${repository.owner.username}/${repository.slug}/pulls`,
        },
      });
      dispatchRepositoryEvent(
        repository.id,
        state === "MERGED" ? "pull_request.merged" : "pull_request.closed",
        {
          number,
          state,
          mergeCommitSha: mergeCommitSha ?? null,
          repository: { name: repository.slug, owner: repository.owner.username },
        },
      );
      return reply.send(success({ pullRequest: updated }));
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
          state: state as "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED",
          body: text,
        },
        include: { reviewer: { select: { id: true, name: true, username: true } } },
      });
      await prisma.notification.create({
        data: {
          id: randomUUID(),
          userId: pullRequest.authorId,
          type: "PULL_REQUEST_REVIEW",
          title: `Review on pull request #${number}`,
          body: `${review.reviewer.name}: ${review.state.replaceAll("_", " ")}`,
          url: `/${repository.owner.username}/${repository.slug}/pulls`,
        },
      });
      dispatchRepositoryEvent(repository.id, "pull_request.reviewed", {
        number,
        review: { state: review.state },
        repository: { name: repository.slug, owner: repository.owner.username },
      });
      return reply.status(201).send(success({ review }));
    },
  );
};
