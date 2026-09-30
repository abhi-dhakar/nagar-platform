import { prisma } from "@nagar/database";
import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { checkServerIdentity } from "node:tls";
import { decryptWebhookSecret, lookupPublicWebhook, webhookSignature } from "./crypto.js";

type EventData = Record<string, unknown>;

export async function notifyRepositoryCollaborators(input: {
  repositoryId: string;
  ownerId: string | null;
  organizationId: string | null;
  actorId: string;
  type: string;
  title: string;
  body: string;
  url: string;
}) {
  const [members, organizationMembers] = await Promise.all([
    prisma.repositoryMember.findMany({
      where: { repositoryId: input.repositoryId },
      select: { userId: true },
    }),
    input.organizationId
      ? prisma.organizationMember.findMany({
          where: { organizationId: input.organizationId },
          select: { userId: true },
        })
      : Promise.resolve([]),
  ]);
  const recipients = [
    ...new Set(
      [
        input.ownerId,
        ...members.map((member) => member.userId),
        ...organizationMembers.map((member) => member.userId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ].filter((userId) => userId !== input.actorId);
  if (!recipients.length) return;
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      id: randomUUID(),
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      url: input.url,
    })),
  });
}

export async function deliverWebhook(webhook: {
  id: string;
  url: string;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  deliveries: { id: string; event: string; payload: string }[];
}) {
  const delivery = webhook.deliveries[0];
  if (!delivery) return;
  try {
    const secret = decryptWebhookSecret(webhook);
    const destination = new URL(webhook.url);
    const resolved = await lookupPublicWebhook(destination.toString());
    if (!resolved) throw new Error("Webhook host resolved to a non-public network address.");
    const pinnedUrl = new URL(destination.toString());
    pinnedUrl.hostname = resolved.address.includes(":")
      ? `[${resolved.address}]`
      : resolved.address;
    const serverName = destination.hostname.replace(/^\[|\]$/g, "");
    const signature = webhookSignature(secret, delivery.payload);
    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = httpsRequest(
        pinnedUrl,
        {
          method: "POST",
          servername: serverName,
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity(serverName, certificate),
          timeout: 5_000,
          headers: {
            host: destination.host,
            "content-type": "application/json",
            "user-agent": "Nagar-Webhooks/1.0",
            "x-nagar-event": delivery.event,
            "x-nagar-delivery": delivery.id,
            "x-nagar-signature-256": signature,
            "content-length": Buffer.byteLength(delivery.payload),
            connection: "close",
          },
        },
        (response) => {
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > 64 * 1024)
              request.destroy(new Error("Webhook response exceeded 64 KB."));
          });
          response.on("end", () => resolve(response.statusCode ?? 0));
          response.on("error", reject);
        },
      );
      request.on("timeout", () => request.destroy(new Error("Webhook request timed out.")));
      request.on("error", reject);
      request.end(delivery.payload);
    });
    const ok = statusCode >= 200 && statusCode < 300;
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: ok ? "SUCCEEDED" : "FAILED",
        statusCode,
        attemptCount: { increment: 1 },
        lastError: ok ? null : `Receiver returned HTTP ${statusCode}`,
        deliveredAt: ok ? new Date() : null,
      },
    });
  } catch (error) {
    await prisma.webhookDelivery
      .update({
        where: { id: delivery.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed.",
        },
      })
      .catch(() => undefined);
  }
}

export function dispatchRepositoryEvent(
  repositoryId: string,
  event: string,
  data: EventData,
): void {
  const payload = JSON.stringify({
    id: randomUUID(),
    event,
    createdAt: new Date().toISOString(),
    data,
  });
  void (async () => {
    const subscriptions = await prisma.webhook.findMany({
      where: {
        repositoryId,
        active: true,
        OR: [{ events: { has: event } }, { events: { has: "*" } }],
      },
      select: { id: true, url: true, secretCiphertext: true, secretIv: true, secretTag: true },
    });
    await Promise.all(
      subscriptions.map(async (webhook) => {
        const delivery = await prisma.webhookDelivery.create({
          data: { id: randomUUID(), webhookId: webhook.id, event, payload },
          select: { id: true, event: true, payload: true },
        });
        await deliverWebhook({ ...webhook, deliveries: [delivery] });
      }),
    );
  })().catch((error: unknown) => {
    console.error("Nagar webhook dispatch failed", error);
  });
}
