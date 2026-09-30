import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { canAccessRepository } from "../repositories/repository-access.js";
import { findReadableRepository } from "../repositories/repository-routes.js";
import { deliverWebhook } from "./events.js";
import { encryptWebhookSecret, validateWebhookUrl } from "./crypto.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});
type RepoParams = { username: string; repository: string };
/** Every event fans out to every webhook, so the number per repository is bounded. */
const MAX_WEBHOOKS = 20;
const events = [
  "issues.opened",
  "issues.closed",
  "issues.reopened",
  "pull_request.opened",
  "pull_request.reviewed",
  "pull_request.closed",
  "pull_request.merged",
  "push",
] as const;

export const repositorySettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: RepoParams }>(
    "/api/v1/repositories/:username/:repository/collaborators",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const [members, organizationMembers] = await Promise.all([
        prisma.repositoryMember.findMany({
          where: { repositoryId: repository.id },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true } } },
        }),
        repository.organizationId
          ? prisma.organizationMember.findMany({
              where: { organizationId: repository.organizationId },
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, name: true, username: true } } },
            })
          : Promise.resolve([]),
      ]);
      return reply.send(success({ owner: repository.owner, members, organizationMembers }));
    },
  );

  app.post<{ Params: RepoParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/collaborators",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const role =
        body.role === "ADMIN"
          ? "ADMIN"
          : body.role === "WRITE"
            ? "WRITE"
            : body.role === "READ"
              ? "READ"
              : null;
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(username) || !role)
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_COLLABORATOR",
              "Provide a valid username and READ, WRITE, or ADMIN access.",
            ),
          );
      if (username === repository.owner.username)
        return reply
          .status(409)
          .send(failure("OWNER_IS_ADMIN", "Repository owners already have admin access."));
      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true, name: true, username: true },
      });
      if (!user)
        return reply.status(404).send(failure("USER_NOT_FOUND", "That Nagar user was not found."));
      try {
        const member = await prisma.repositoryMember.create({
          data: { id: randomUUID(), repositoryId: repository.id, userId: user.id, role },
          include: { user: { select: { id: true, name: true, username: true } } },
        });
        await prisma.notification.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            type: "REPOSITORY_COLLABORATOR",
            title: `Repository access granted`,
            body: `You have ${role.toLowerCase()} access to ${repository.owner.username}/${repository.slug}.`,
            url: `/${repository.owner.username}/${repository.slug}`,
          },
        });
        return reply.status(201).send(success({ member }));
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          return reply
            .status(409)
            .send(failure("ALREADY_COLLABORATOR", "That user already has repository access."));
        throw error;
      }
    },
  );

  app.patch<{ Params: RepoParams & { memberUsername: string }; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/collaborators/:memberUsername",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const role = body.role;
      if (role !== "READ" && role !== "WRITE" && role !== "ADMIN")
        return reply
          .status(400)
          .send(failure("INVALID_ROLE", "Role must be READ, WRITE, or ADMIN."));
      const member = await prisma.repositoryMember.findFirst({
        where: {
          repositoryId: repository.id,
          user: { username: request.params.memberUsername.toLowerCase() },
        },
      });
      if (!member)
        return reply.status(404).send(failure("MEMBER_NOT_FOUND", "Collaborator was not found."));
      const updated = await prisma.repositoryMember.update({
        where: { id: member.id },
        data: { role },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return reply.send(success({ member: updated }));
    },
  );

  app.delete<{ Params: RepoParams & { memberUsername: string } }>(
    "/api/v1/repositories/:username/:repository/collaborators/:memberUsername",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const member = await prisma.repositoryMember.findFirst({
        where: {
          repositoryId: repository.id,
          user: { username: request.params.memberUsername.toLowerCase() },
        },
      });
      if (!member)
        return reply.status(404).send(failure("MEMBER_NOT_FOUND", "Collaborator was not found."));
      await prisma.repositoryMember.delete({ where: { id: member.id } });
      return reply.send(success({ removed: true }));
    },
  );

  app.get<{ Params: RepoParams }>(
    "/api/v1/repositories/:username/:repository/webhooks",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const webhooks = await prisma.webhook.findMany({
        where: { repositoryId: repository.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          createdAt: true,
          deliveries: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              event: true,
              status: true,
              statusCode: true,
              attemptCount: true,
              lastError: true,
              createdAt: true,
            },
          },
        },
      });
      return reply.send(success({ webhooks, availableEvents: events }));
    },
  );

  app.post<{ Params: RepoParams; Body: unknown }>(
    "/api/v1/repositories/:username/:repository/webhooks",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const url = await validateWebhookUrl(body.url);
      const requestedEvents = Array.isArray(body.events)
        ? [...new Set(body.events.filter((event): event is string => typeof event === "string"))]
        : [];
      if (
        !url ||
        requestedEvents.length === 0 ||
        requestedEvents.length > events.length ||
        requestedEvents.some((event) => !events.includes(event as (typeof events)[number]))
      )
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_WEBHOOK",
              "Use a public HTTPS URL and choose one or more supported events.",
            ),
          );
      if ((await prisma.webhook.count({ where: { repositoryId: repository.id } })) >= MAX_WEBHOOKS)
        return reply
          .status(409)
          .send(
            failure(
              "WEBHOOK_LIMIT_REACHED",
              `A repository can have at most ${MAX_WEBHOOKS} webhooks. Remove one first.`,
            ),
          );
      const secret = randomBytes(32).toString("base64url");
      let encrypted: ReturnType<typeof encryptWebhookSecret>;
      try {
        encrypted = encryptWebhookSecret(secret);
      } catch (error) {
        return reply
          .status(503)
          .send(
            failure(
              "WEBHOOKS_NOT_CONFIGURED",
              error instanceof Error ? error.message : "Webhook encryption is not configured.",
            ),
          );
      }
      const webhook = await prisma.webhook.create({
        data: {
          id: randomUUID(),
          repositoryId: repository.id,
          url,
          events: requestedEvents,
          ...encrypted,
        },
        select: { id: true, url: true, events: true, active: true, createdAt: true },
      });
      return reply.status(201).send(success({ webhook, secret }));
    },
  );

  app.delete<{ Params: RepoParams & { webhookId: string } }>(
    "/api/v1/repositories/:username/:repository/webhooks/:webhookId",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const deleted = await prisma.webhook.deleteMany({
        where: { id: request.params.webhookId, repositoryId: repository.id },
      });
      if (!deleted.count)
        return reply.status(404).send(failure("WEBHOOK_NOT_FOUND", "Webhook was not found."));
      return reply.send(success({ removed: true }));
    },
  );

  app.post<{ Params: RepoParams & { webhookId: string; deliveryId: string } }>(
    "/api/v1/repositories/:username/:repository/webhooks/:webhookId/deliveries/:deliveryId/retry",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const repository = await findReadableRepository(
        request.params.username,
        request.params.repository,
        userId,
      );
      if (!repository)
        return reply.status(404).send(failure("REPOSITORY_NOT_FOUND", "Repository was not found."));
      if (!(await canAccessRepository(repository, userId, "ADMIN")))
        return reply.status(403).send(failure("FORBIDDEN", "Repository admin access is required."));
      const webhook = await prisma.webhook.findFirst({
        where: { id: request.params.webhookId, repositoryId: repository.id },
        select: { id: true, url: true, secretCiphertext: true, secretIv: true, secretTag: true },
      });
      const delivery = await prisma.webhookDelivery.findFirst({
        where: {
          id: request.params.deliveryId,
          webhookId: request.params.webhookId,
          status: "FAILED",
        },
        select: { id: true, event: true, payload: true },
      });
      if (!webhook || !delivery)
        return reply
          .status(404)
          .send(failure("DELIVERY_NOT_FOUND", "Failed webhook delivery was not found."));
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PENDING", lastError: null },
      });
      await deliverWebhook({ ...webhook, deliveries: [{ ...delivery }] });
      const updated = await prisma.webhookDelivery.findUnique({
        where: { id: delivery.id },
        select: {
          id: true,
          status: true,
          statusCode: true,
          attemptCount: true,
          lastError: true,
          deliveredAt: true,
        },
      });
      return reply.send(success({ delivery: updated }));
    },
  );
};
