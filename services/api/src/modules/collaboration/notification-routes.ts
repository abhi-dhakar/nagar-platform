import { prisma } from "@nagar/database";
import type { ApiFailure, ApiSuccess } from "@nagar/types";
import type { FastifyPluginAsync } from "fastify";
import { currentUserId } from "../auth/current-user.js";

const success = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
const failure = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message },
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/notifications", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send(
      success({ notifications, unreadCount: notifications.filter((item) => !item.readAt).length }),
    );
  });

  app.patch<{ Params: { id: string } }>(
    "/api/v1/notifications/:id/read",
    async (request, reply) => {
      const userId = await currentUserId(request);
      if (!userId)
        return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
      const result = await prisma.notification.updateMany({
        where: { id: request.params.id, userId },
        data: { readAt: new Date() },
      });
      if (!result.count)
        return reply
          .status(404)
          .send(failure("NOTIFICATION_NOT_FOUND", "Notification was not found."));
      return reply.send(success({ markedRead: true }));
    },
  );

  app.post("/api/v1/notifications/read-all", async (request, reply) => {
    const userId = await currentUserId(request);
    if (!userId) return reply.status(401).send(failure("UNAUTHENTICATED", "Sign in to continue."));
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.send(success({ markedRead: result.count }));
  });
};
