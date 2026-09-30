import { prisma } from "@nagar/database";
import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
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
  /** Extra people who should hear about this (for example the author of an issue). */
  extraRecipientIds?: readonly string[];
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
        ...(input.extraRecipientIds ?? []),
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

export interface WebhookRequest {
  /** The already SSRF-checked address the connection must go to (DNS is never consulted again). */
  address: string;
  /** The destination the subscriber configured; its host is used for TLS and the Host header. */
  url: URL;
  body: string;
  headers: Record<string, string>;
}

/** Sends one webhook request and resolves with the receiver's HTTP status code. */
export type WebhookTransport = (request: WebhookRequest) => Promise<number>;

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * The production transport: HTTPS only, connects to the pinned address, verifies the
 * certificate against the configured hostname, never follows redirects, and bounds both the
 * wait and the amount of response it will read.
 */
export function createHttpsWebhookTransport(
  options: { ca?: string | Buffer } = {},
): WebhookTransport {
  return ({ address, url, body, headers }) =>
    new Promise<number>((resolve, reject) => {
      const pinnedUrl = new URL(url.toString());
      pinnedUrl.hostname = address.includes(":") ? `[${address}]` : address;
      const serverName = url.hostname.replace(/^\[|\]$/g, "");
      const request = httpsRequest(
        pinnedUrl,
        {
          method: "POST",
          // SNI must be a hostname; TLS forbids sending an IP literal as the server name.
          ...(isIP(serverName) ? {} : { servername: serverName }),
          ...(options.ca ? { ca: options.ca } : {}),
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity(serverName, certificate),
          timeout: WEBHOOK_TIMEOUT_MS,
          headers: {
            ...headers,
            host: url.host,
            "content-length": Buffer.byteLength(body),
            connection: "close",
          },
        },
        (response) => {
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > WEBHOOK_MAX_RESPONSE_BYTES)
              request.destroy(new Error("Webhook response exceeded 64 KB."));
          });
          response.on("end", () => resolve(response.statusCode ?? 0));
          response.on("error", reject);
        },
      );
      request.on("timeout", () => request.destroy(new Error("Webhook request timed out.")));
      request.on("error", reject);
      request.end(body);
    });
}

let activeTransport: WebhookTransport = createHttpsWebhookTransport();

/** Test hook: swap the network transport (pass `null` to restore the real one). */
export function setWebhookTransport(transport: WebhookTransport | null): void {
  activeTransport = transport ?? createHttpsWebhookTransport();
}

export async function deliverWebhook(
  webhook: {
    id: string;
    url: string;
    secretCiphertext: string;
    secretIv: string;
    secretTag: string;
    deliveries: { id: string; event: string; payload: string }[];
  },
  transport: WebhookTransport = activeTransport,
) {
  const delivery = webhook.deliveries[0];
  if (!delivery) return;
  try {
    const secret = decryptWebhookSecret(webhook);
    const destination = new URL(webhook.url);
    const resolved = await lookupPublicWebhook(destination.toString());
    if (!resolved) throw new Error("Webhook host resolved to a non-public network address.");
    const statusCode = await transport({
      address: resolved.address,
      url: destination,
      body: delivery.payload,
      headers: {
        "content-type": "application/json",
        "user-agent": "Nagar-Webhooks/1.0",
        "x-nagar-event": delivery.event,
        "x-nagar-delivery": delivery.id,
        "x-nagar-signature-256": webhookSignature(secret, delivery.payload),
      },
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
