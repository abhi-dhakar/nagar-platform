import cors from "@fastify/cors";
import { auth } from "@nagar/auth";
import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess, HealthData } from "@nagar/types";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyInstance } from "fastify";
import { createClient } from "redis";
import { currentUserId } from "./modules/auth/current-user.js";
import { gitRoutes } from "./modules/git/git-routes.js";
import { profileRoutes } from "./modules/users/profile-routes.js";
import { repositoryRoutes } from "./modules/repositories/repository-routes.js";
import { collaborationRoutes } from "./modules/collaboration/repository-routes.js";
import { organizationRoutes } from "./modules/collaboration/organization-routes.js";
import { notificationRoutes } from "./modules/collaboration/notification-routes.js";
import { repositorySettingsRoutes } from "./modules/collaboration/settings-routes.js";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
redis.on("error", (error: Error) => {
  // Keep the API available for liveness checks when Redis is temporarily down.
  app?.log.warn({ err: error }, "Redis connection error");
});

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let app: FastifyInstance | undefined;

function success<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

function failure(code: string, message: string): ApiFailure {
  return { success: false, error: { code, message } };
}

async function checkRedis(): Promise<void> {
  if (!redis.isOpen) await redis.connect();
  await redis.ping();
}

export async function createApiServer(): Promise<FastifyInstance> {
  app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: false });

  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 86400,
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Request failed");
    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;
    return reply
      .status(status)
      .send(failure("INTERNAL_ERROR", "The request could not be completed."));
  });

  app.get<{ Reply: ApiSuccess<HealthData> }>("/api/v1/health", async () =>
    success({ status: "ok", service: "nagar-api", timestamp: new Date().toISOString() }),
  );

  app.get("/api/v1/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await checkRedis();
      return reply.send(success({ status: "ready" as const }));
    } catch (error) {
      app?.log.warn({ err: error }, "Readiness check failed");
      return reply
        .status(503)
        .send(failure("DEPENDENCY_UNAVAILABLE", "A required service is unavailable."));
    }
  });

  app.get("/api/v1/me", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, username: true, bio: true, createdAt: true },
    });
    if (!user) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    return reply.send(success({ user }));
  });

  await app.register(profileRoutes);
  await app.register(repositoryRoutes);
  await app.register(collaborationRoutes);
  await app.register(organizationRoutes);
  await app.register(notificationRoutes);
  await app.register(repositorySettingsRoutes);
  await app.register(gitRoutes);

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(request.url, process.env.BETTER_AUTH_URL ?? "http://localhost:4000");
        const headers = fromNodeHeaders(request.headers);
        headers.delete("host");
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        headers.delete("connection");
        const body = request.body === undefined ? undefined : JSON.stringify(request.body);
        const webRequest = new Request(url, {
          method: request.method,
          headers,
          ...(body !== undefined && request.method !== "GET" ? { body } : {}),
        });
        const response = await auth.handler(webRequest);
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        const responseText = await response.text();
        return reply.send(responseText || null);
      } catch (error) {
        request.log.error({ err: error }, "Authentication request failed");
        return reply
          .status(500)
          .send(failure("AUTH_FAILURE", "Authentication could not be completed."));
      }
    },
  });

  app.addHook("onClose", async () => {
    if (redis.isOpen) await redis.quit();
    await prisma.$disconnect();
  });

  return app;
}
