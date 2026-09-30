import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";
import { gitStore } from "../repositories/repository-routes.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});
const slugify = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 39)
    : "";

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/organizations", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    const organizations = await prisma.organization.findMany({
      where: { members: { some: { userId } } },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId }, select: { role: true } },
      },
    });
    return reply.send(success({ organizations }));
  });

  app.post<{ Body: unknown }>("/api/v1/organizations", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      return reply
        .status(400)
        .send(failure("INVALID_ORGANIZATION", "Provide an organization name."));
    const body = request.body as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug = slugify(body.slug ?? name);
    const description =
      body.description === undefined
        ? null
        : typeof body.description === "string"
          ? body.description.trim()
          : undefined;
    if (
      name.length < 2 ||
      name.length > 80 ||
      slug.length < 2 ||
      (description !== null && description !== undefined && description.length > 280)
    )
      return reply
        .status(400)
        .send(
          failure(
            "INVALID_ORGANIZATION",
            "Organization name must be 2–80 characters; slug 2–39; description up to 280.",
          ),
        );
    if (await prisma.user.findUnique({ where: { username: slug }, select: { id: true } }))
      return reply
        .status(409)
        .send(failure("ORGANIZATION_EXISTS", "That slug is already used by a Nagar username."));
    try {
      const organization = await prisma.organization.create({
        data: {
          id: randomUUID(),
          name,
          slug,
          description: description || null,
          createdById: userId,
          members: { create: { id: randomUUID(), userId, role: "OWNER" } },
        },
        include: {
          _count: { select: { members: true } },
          members: { include: { user: { select: { id: true, name: true, username: true } } } },
        },
      });
      return reply.status(201).send(success({ organization }));
    } catch (error) {
      if (isUniqueViolation(error))
        return reply
          .status(409)
          .send(failure("ORGANIZATION_EXISTS", "That organization slug is already taken."));
      throw error;
    }
  });

  app.get<{ Params: { slug: string } }>("/api/v1/organizations/:slug", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    const organization = await prisma.organization.findUnique({
      where: { slug: slugify(request.params.slug) },
      include: {
        members: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true } } },
        },
        repositories: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            visibility: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!organization)
      return reply
        .status(404)
        .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
    const membership = organization.members.find((item) => item.userId === userId);
    if (!membership)
      return reply
        .status(404)
        .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
    return reply.send(success({ organization, role: membership.role }));
  });

  app.post<{ Params: { slug: string }; Body: unknown }>(
    "/api/v1/organizations/:slug/repositories",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const organization = await prisma.organization.findUnique({
        where: { slug: slugify(request.params.slug) },
        include: { members: { where: { userId }, select: { role: true } } },
      });
      if (!organization)
        return reply
          .status(404)
          .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
      if (!organization.members.length)
        return reply.status(403).send(failure("FORBIDDEN", "Organization membership is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const repositorySlug = slugify(body.slug ?? name);
      const description = body.description === undefined ? "" : body.description;
      const visibility =
        body.visibility === "PUBLIC"
          ? "PUBLIC"
          : body.visibility === "PRIVATE" || body.visibility === undefined
            ? "PRIVATE"
            : null;
      if (
        !repositorySlug ||
        name.length < 1 ||
        name.length > 100 ||
        typeof description !== "string" ||
        description.trim().length > 350 ||
        !visibility
      )
        return reply
          .status(400)
          .send(
            failure(
              "INVALID_REPOSITORY",
              "Provide a 1–100 character repository name, short description, and PUBLIC or PRIVATE visibility.",
            ),
          );
      const id = randomUUID();
      const gitPath = `${id}.git`;
      let metadataCreated = false;
      try {
        await gitStore.createBare(gitPath);
        if (body.initializeWithReadme !== false) await gitStore.initializeReadme(gitPath, name);
        const repository = await prisma.repository.create({
          data: {
            id,
            organizationId: organization.id,
            name,
            slug: repositorySlug,
            description: description.trim() || null,
            visibility,
            gitPath,
          },
        });
        metadataCreated = true;
        const {
          gitPath: _gitPath,
          ownerId: _ownerId,
          organizationId: _organizationId,
          ...safeRepository
        } = repository;
        return reply
          .status(201)
          .send(
            success({
              repository: {
                ...safeRepository,
                namespace: organization.slug,
                namespaceType: "ORGANIZATION",
                cloneUrl: `${(process.env.NAGAR_GIT_BASE_URL ?? "http://localhost:4000/git").replace(/\/+$/, "")}/${encodeURIComponent(organization.slug)}/${encodeURIComponent(repository.slug)}.git`,
              },
            }),
          );
      } catch (error) {
        if (metadataCreated)
          await prisma.repository.delete({ where: { id } }).catch(() => undefined);
        await gitStore.remove(gitPath).catch(() => undefined);
        if (isUniqueViolation(error))
          return reply
            .status(409)
            .send(
              failure(
                "REPOSITORY_EXISTS",
                "A repository with that name already exists in this organization.",
              ),
            );
        throw error;
      }
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    "/api/v1/organizations/:slug/members",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const organization = await prisma.organization.findUnique({
        where: { slug: slugify(request.params.slug) },
        include: { members: { where: { userId }, select: { role: true } } },
      });
      if (!organization)
        return reply
          .status(404)
          .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
      if (!organization.members[0] || !["OWNER", "ADMIN"].includes(organization.members[0].role))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Organization admin access is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";
      if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(username))
        return reply.status(400).send(failure("INVALID_USERNAME", "Enter a valid Nagar username."));
      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true, name: true, username: true },
      });
      if (!user)
        return reply.status(404).send(failure("USER_NOT_FOUND", "That Nagar user was not found."));
      try {
        const member = await prisma.organizationMember.create({
          data: { id: randomUUID(), organizationId: organization.id, userId: user.id, role },
          include: { user: { select: { id: true, name: true, username: true } } },
        });
        await prisma.notification.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            type: "ORGANIZATION_MEMBER",
            title: `Added to ${organization.name}`,
            body: `You are now a ${role.toLowerCase()} of ${organization.name}.`,
            url: `/organizations/${organization.slug}`,
          },
        });
        return reply.status(201).send(success({ member }));
      } catch (error) {
        if (isUniqueViolation(error))
          return reply
            .status(409)
            .send(failure("ALREADY_MEMBER", "That user is already in the organization."));
        throw error;
      }
    },
  );

  app.patch<{ Params: { slug: string; username: string }; Body: unknown }>(
    "/api/v1/organizations/:slug/members/:username",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const organization = await prisma.organization.findUnique({
        where: { slug: slugify(request.params.slug) },
        include: { members: { where: { userId }, select: { role: true } } },
      });
      if (!organization)
        return reply
          .status(404)
          .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
      if (!organization.members[0] || !["OWNER", "ADMIN"].includes(organization.members[0].role))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Organization admin access is required."));
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      if (body.role !== "ADMIN" && body.role !== "MEMBER")
        return reply
          .status(400)
          .send(failure("INVALID_ROLE", "Organization members can be ADMIN or MEMBER."));
      const member = await prisma.organizationMember.findFirst({
        where: {
          organizationId: organization.id,
          user: { username: request.params.username.toLowerCase() },
        },
      });
      if (!member)
        return reply
          .status(404)
          .send(failure("MEMBER_NOT_FOUND", "Organization member was not found."));
      if (member.role === "OWNER")
        return reply
          .status(409)
          .send(
            failure("OWNER_ROLE_LOCKED", "Transfer ownership through a dedicated ownership flow."),
          );
      const updated = await prisma.organizationMember.update({
        where: { id: member.id },
        data: { role: body.role },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return reply.send(success({ member: updated }));
    },
  );

  app.delete<{ Params: { slug: string; username: string } }>(
    "/api/v1/organizations/:slug/members/:username",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const organization = await prisma.organization.findUnique({
        where: { slug: slugify(request.params.slug) },
        include: { members: { where: { userId }, select: { role: true } } },
      });
      if (!organization)
        return reply
          .status(404)
          .send(failure("ORGANIZATION_NOT_FOUND", "Organization was not found."));
      const actor = organization.members[0];
      if (!actor || !["OWNER", "ADMIN"].includes(actor.role))
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Organization admin access is required."));
      const member = await prisma.organizationMember.findFirst({
        where: {
          organizationId: organization.id,
          user: { username: request.params.username.toLowerCase() },
        },
      });
      if (!member)
        return reply
          .status(404)
          .send(failure("MEMBER_NOT_FOUND", "Organization member was not found."));
      if (member.role === "OWNER")
        return reply
          .status(409)
          .send(failure("OWNER_ROLE_LOCKED", "Transfer ownership before removing an owner."));
      if (actor.role !== "OWNER" && member.role === "ADMIN")
        return reply
          .status(403)
          .send(failure("FORBIDDEN", "Only an owner can remove another organization admin."));
      await prisma.organizationMember.delete({ where: { id: member.id } });
      return reply.send(success({ removed: true }));
    },
  );
};
