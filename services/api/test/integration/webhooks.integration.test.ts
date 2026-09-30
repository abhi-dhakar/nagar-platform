import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "@nagar/database";
import {
  decryptWebhookSecret,
  verifyWebhookSignature,
} from "../../src/modules/collaboration/crypto.js";
import {
  createHttpsWebhookTransport,
  setWebhookTransport,
  type WebhookRequest,
} from "../../src/modules/collaboration/events.js";
import { TEST_TLS_CERT, TEST_TLS_KEY } from "../fixtures/webhook-tls.js";
import { eventually, integrationSuite, sleep, type ApiClient } from "./harness.js";

// A public IP literal: it passes the SSRF rules without any DNS lookup. Nothing is ever sent
// to it, because these tests replace the network transport.
const TARGET = "https://93.184.216.34/nagar-hook";

await integrationSuite("NagarHub webhooks", (harness) => {
  let owner: ApiClient;
  let writer: ApiClient;
  let anonymous: ApiClient;
  let hooks = "";
  let base = "";
  let sent: WebhookRequest[] = [];
  let respond: (request: WebhookRequest) => number | Promise<number> = () => 200;

  before(async () => {
    await harness.start();
    owner = await harness.user("hookowner");
    writer = await harness.user("hookwriter");
    anonymous = harness.anonymous();
    base = `/api/v1/repositories/${owner.username}/hooked`;
    hooks = `${base}/webhooks`;
    await owner.post("/api/v1/repositories", { name: "hooked", visibility: "PUBLIC" });
    await owner.post(`${base}/collaborators`, { username: writer.username, role: "WRITE" });
    setWebhookTransport(async (request) => {
      sent.push(request);
      return respond(request);
    });
  });
  afterEach(() => {
    sent = [];
    respond = () => 200;
  });
  after(async () => {
    setWebhookTransport(null);
    await harness.stop();
  });

  const events = ["push", "issues.opened"];
  async function create(url = TARGET, subscribe: string[] = events) {
    const response = await owner.post(hooks, { url, events: subscribe });
    assert.equal(response.status, 201, response.text);
    return {
      id: response.json.data.webhook.id as string,
      secret: response.json.data.secret as string,
    };
  }
  const deliveries = (webhookId: string) =>
    prisma.webhookDelivery.findMany({ where: { webhookId }, orderBy: { createdAt: "asc" } });
  const bodyOf = (request: WebhookRequest) => JSON.parse(request.body);
  /** Waits until `count` deliveries exist and all have finished (the transport has been called). */
  const settled = (webhookId: string, count: number) =>
    eventually(async () => {
      const rows = await deliveries(webhookId);
      return rows.length === count && rows.every((row) => row.status !== "PENDING") ? rows : false;
    });

  async function cleanup() {
    const list = (await owner.get(hooks)).json.data.webhooks as { id: string }[];
    for (const hook of list) await owner.delete(`${hooks}/${hook.id}`);
  }

  describe("registering endpoints", () => {
    it("accepts only public HTTPS URLs", async () => {
      const rejected = [
        "http://93.184.216.34/hook",
        "https://localhost/hook",
        "https://127.0.0.1/hook",
        "https://10.1.2.3/hook",
        "https://172.16.0.9/hook",
        "https://192.168.0.1/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://100.64.0.1/hook",
        "https://[::1]/hook",
        "https://[::ffff:7f00:1]/hook",
        "https://[fd00::1]/hook",
        "https://0x7f000001/hook",
        "https://2130706433/hook",
        "https://user:secret@93.184.216.34/hook",
        "https://93.184.216.34/hook#fragment",
        "https://internal.local/hook",
        "https://app.localhost/hook",
        "ftp://93.184.216.34/hook",
        "not a url",
        `https://93.184.216.34/${"a".repeat(2100)}`,
      ];
      for (const url of rejected) {
        const response = await owner.post(hooks, { url, events: ["push"] });
        assert.equal(response.status, 400, url.slice(0, 60));
        assert.equal(response.json.error.code, "INVALID_WEBHOOK");
      }
    });

    it("validates the event list", async () => {
      assert.equal((await owner.post(hooks, { url: TARGET, events: [] })).status, 400);
      assert.equal((await owner.post(hooks, { url: TARGET, events: ["nope"] })).status, 400);
      assert.equal((await owner.post(hooks, { url: TARGET })).status, 400);
    });

    it("shows the secret once, stores it encrypted, and never lists it", async () => {
      const { id, secret } = await create();
      assert.ok(secret.length >= 32);
      const row = await prisma.webhook.findUniqueOrThrow({ where: { id } });
      assert.notEqual(row.secretCiphertext, secret);
      assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
      assert.equal(decryptWebhookSecret(row), secret, "recoverable with the server key");

      const listed = await owner.get(hooks);
      assert.equal(listed.status, 200);
      assert.doesNotMatch(listed.text, new RegExp(secret));
      assert.doesNotMatch(listed.text, /secret|ciphertext/i);
      assert.deepEqual(listed.json.data.availableEvents.includes("push"), true);
      await cleanup();
    });

    it("is limited to repository admins", async () => {
      assert.equal((await writer.post(hooks, { url: TARGET, events: ["push"] })).status, 403);
      assert.equal((await writer.get(hooks)).status, 403);
      assert.equal((await anonymous.get(hooks)).status, 401);
      const { id } = await create();
      assert.equal((await writer.delete(`${hooks}/${id}`)).status, 403);
      assert.equal((await owner.delete(`${hooks}/${id}`)).status, 200);
      assert.equal((await owner.delete(`${hooks}/${id}`)).status, 404);
    });

    it("caps how many endpoints one repository can fan out to", async () => {
      for (let index = 0; index < 20; index++) await create(`${TARGET}-${index}`);
      const extra = await owner.post(hooks, { url: `${TARGET}-extra`, events: ["push"] });
      assert.equal(extra.status, 409);
      assert.equal(extra.json.error.code, "WEBHOOK_LIMIT_REACHED");
      await cleanup();
    });
  });

  describe("delivering events", () => {
    it("signs and delivers an issue event with the documented payload", async () => {
      const { id, secret } = await create();
      const opened = await writer.post(`${base}/issues`, { title: "Hook me", body: "please" });
      assert.equal(opened.status, 201);
      await settled(id, 1);

      assert.equal(sent.length, 1);
      const request = sent[0]!;
      assert.equal(request.address, "93.184.216.34", "connects to the address that was checked");
      assert.equal(request.url.toString(), TARGET);
      assert.equal(request.headers["x-nagar-event"], "issues.opened");
      assert.equal(request.headers["content-type"], "application/json");
      assert.match(request.headers["user-agent"] ?? "", /^Nagar-Webhooks\//);
      assert.ok(
        verifyWebhookSignature(
          secret,
          request.body,
          request.headers["x-nagar-signature-256"] ?? "",
        ),
        "the HMAC-SHA256 signature verifies with the secret shown at creation",
      );
      assert.equal(
        verifyWebhookSignature(
          "a-different-secret",
          request.body,
          request.headers["x-nagar-signature-256"] ?? "",
        ),
        false,
      );
      const payload = bodyOf(request);
      assert.equal(payload.event, "issues.opened");
      assert.match(payload.id, /^[0-9a-f-]{36}$/);
      assert.equal(payload.data.issue.title, "Hook me");
      assert.deepEqual(payload.data.repository, { name: "hooked", owner: owner.username });
      assert.equal(payload.data.sender.username, writer.username);
      assert.equal(request.headers["x-nagar-delivery"], (await deliveries(id))[0]!.id);

      const [delivery] = await deliveries(id);
      assert.equal(delivery!.status, "SUCCEEDED");
      assert.equal(delivery!.statusCode, 200);
      assert.equal(delivery!.attemptCount, 1);
      await cleanup();
    });

    it("sends exactly one push event per push, with the ref and the new commits", async () => {
      const { id } = await create(TARGET, ["push"]);
      const clone = await harness.clone(owner.username, "hooked", owner);
      await harness.commit(clone.dir, "one.txt", "1\n", "feat: first pushed commit");
      await harness.commit(clone.dir, "two.txt", "2\n", "feat: second pushed commit");
      const before = (await harness.git(["rev-parse", "origin/main"], { cwd: clone.dir })).out;
      const after = (await harness.git(["rev-parse", "HEAD"], { cwd: clone.dir })).out;
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);

      await settled(id, 1);
      await sleep(400); // a duplicate, if there were one, would have arrived by now
      assert.equal((await deliveries(id)).length, 1, "the advertisement request is not a push");

      const payload = bodyOf(sent[0]!);
      assert.equal(sent[0]!.headers["x-nagar-event"], "push");
      assert.equal(payload.data.ref, "refs/heads/main");
      assert.equal(payload.data.before, before);
      assert.equal(payload.data.after, after);
      assert.equal(payload.data.created, false);
      assert.equal(payload.data.deleted, false);
      assert.deepEqual(
        payload.data.commits.map((commit: { message: string }) => commit.message),
        ["feat: second pushed commit", "feat: first pushed commit"],
      );
      assert.equal(payload.data.commits[0].id, after);
      assert.equal(payload.data.pusher.username, owner.username);
      assert.deepEqual(payload.data.repository, { name: "hooked", owner: owner.username });
      await cleanup();
    });

    it("reports branch creation and deletion, and stays silent when nothing changed", async () => {
      const { id } = await create(TARGET, ["push"]);
      const clone = await harness.clone(owner.username, "hooked", owner);
      await harness.git(["checkout", "-b", "feature/hooks"], { cwd: clone.dir });
      await harness.commit(clone.dir, "branch.txt", "b\n", "feat: on a branch");
      assert.ok((await harness.git(["push", "origin", "feature/hooks"], { cwd: clone.dir })).ok);
      await settled(id, 1);
      const created = bodyOf(sent[0]!).data;
      assert.equal(created.ref, "refs/heads/feature/hooks");
      assert.equal(created.created, true);
      assert.match(created.before, /^0{40}$/);
      assert.deepEqual(
        created.commits.map((commit: { message: string }) => commit.message),
        ["feat: on a branch"],
      );

      assert.ok(
        (await harness.git(["push", "origin", "feature/hooks"], { cwd: clone.dir })).ok,
        "up to date",
      );
      await sleep(400);
      assert.equal((await deliveries(id)).length, 1, "a no-op push is not an event");

      assert.ok((await harness.git(["push", "origin", ":feature/hooks"], { cwd: clone.dir })).ok);
      await settled(id, 2);
      const removed = bodyOf(sent[1]!).data;
      assert.equal(removed.deleted, true);
      assert.match(removed.after, /^0{40}$/);
      assert.deepEqual(removed.commits, []);
      await cleanup();
    });

    it("does not announce pushes that were refused", async () => {
      const { id } = await create(TARGET, ["push"]);
      const clone = await harness.clone(owner.username, "hooked", writer, "wrong-password-123");
      assert.equal(clone.ok, true, "public repositories can still be cloned anonymously");
      await harness.commit(clone.dir, "nope.txt", "x\n", "feat: refused");
      const pushed = await harness.git(["push", "origin", "main"], { cwd: clone.dir });
      assert.equal(pushed.ok, false);
      await sleep(400);
      assert.equal((await deliveries(id)).length, 0);
      await cleanup();
    });

    it("only delivers the events an endpoint subscribed to", async () => {
      const { id } = await create(TARGET, ["pull_request.opened"]);
      await writer.post(`${base}/issues`, { title: "not subscribed" });
      const clone = await harness.clone(owner.username, "hooked", owner);
      await harness.commit(clone.dir, "quiet.txt", "q\n", "feat: quiet");
      await harness.git(["push", "origin", "main"], { cwd: clone.dir });
      await sleep(500);
      assert.equal((await deliveries(id)).length, 0);
      await cleanup();
    });

    it("emits consistent pull request payloads for opened, reviewed, and merged", async () => {
      const all = await owner.post(hooks, {
        url: TARGET,
        events: [
          "pull_request.opened",
          "pull_request.reviewed",
          "pull_request.merged",
          "pull_request.closed",
        ],
      });
      const hookId = all.json.data.webhook.id as string;
      const clone = await harness.clone(owner.username, "hooked", owner);
      await harness.git(["checkout", "-b", "feature/pr"], { cwd: clone.dir });
      await harness.commit(clone.dir, "pr.txt", "pr\n", "feat: pr change");
      await harness.git(["push", "origin", "feature/pr"], { cwd: clone.dir });

      const opened = await writer.post(`${base}/pulls`, {
        title: "PR",
        baseBranch: "main",
        headBranch: "feature/pr",
      });
      const number = opened.json.data.pullRequest.number;
      await owner.post(`${base}/pulls/${number}/reviews`, { state: "APPROVED", body: "lgtm" });
      assert.equal((await owner.patch(`${base}/pulls/${number}`, { state: "MERGED" })).status, 200);
      await settled(hookId, 3);

      const payloads = sent.map(bodyOf).sort((a, b) => a.event.localeCompare(b.event));
      assert.deepEqual(
        payloads.map((p) => p.event),
        ["pull_request.merged", "pull_request.opened", "pull_request.reviewed"],
      );
      for (const payload of payloads) {
        assert.equal(payload.data.pullRequest.number, number, payload.event);
        assert.equal(payload.data.pullRequest.base, "main");
        assert.equal(payload.data.pullRequest.head, "feature/pr");
        assert.deepEqual(payload.data.repository, { name: "hooked", owner: owner.username });
        assert.ok(payload.data.sender.username);
      }
      const merged = payloads.find((p) => p.event === "pull_request.merged");
      assert.equal(merged.data.pullRequest.state, "MERGED");
      assert.match(merged.data.pullRequest.mergeCommitSha, /^[0-9a-f]{40}$/);
      const reviewed = payloads.find((p) => p.event === "pull_request.reviewed");
      assert.deepEqual(reviewed.data.review, { state: "APPROVED", body: "lgtm" });
      await cleanup();
    });
  });

  describe("failures and retries", () => {
    it("records receiver errors and lets an admin retry the delivery", async () => {
      const { id } = await create(TARGET, ["issues.opened"]);
      respond = () => 500;
      await writer.post(`${base}/issues`, { title: "will fail first" });
      await settled(id, 1);
      const [failed] = await deliveries(id);
      assert.equal(failed!.status, "FAILED");
      assert.equal(failed!.statusCode, 500);
      assert.equal(failed!.lastError, "Receiver returned HTTP 500");

      respond = () => 200;
      const retry = await owner.post(`${hooks}/${id}/deliveries/${failed!.id}/retry`);
      assert.equal(retry.status, 200);
      assert.equal(retry.json.data.delivery.status, "SUCCEEDED");
      assert.equal(retry.json.data.delivery.attemptCount, 2);
      const retried = sent.at(-1)!;
      assert.equal(
        retried.headers["x-nagar-delivery"],
        failed!.id,
        "same delivery id for idempotency",
      );
      assert.equal(retried.body, sent[0]!.body, "the exact same payload is re-sent");

      assert.equal(
        (await owner.post(`${hooks}/${id}/deliveries/${failed!.id}/retry`)).status,
        404,
        "only failed ones",
      );
      assert.equal(
        (await writer.post(`${hooks}/${id}/deliveries/${failed!.id}/retry`)).status,
        403,
      );
      await cleanup();
    });

    it("records network errors without failing the request that caused the event", async () => {
      const { id } = await create(TARGET, ["issues.opened"]);
      respond = () => {
        throw new Error("connect ETIMEDOUT");
      };
      const opened = await writer.post(`${base}/issues`, { title: "receiver is down" });
      assert.equal(opened.status, 201, "the issue is created regardless of webhook health");
      await settled(id, 1);
      const [delivery] = await deliveries(id);
      assert.equal(delivery!.status, "FAILED");
      assert.equal(delivery!.lastError, "connect ETIMEDOUT");
      await cleanup();
    });

    it("re-checks the destination at delivery time, so a stored private URL is never contacted", async () => {
      const { id } = await create(TARGET, ["issues.opened"]);
      // Simulates DNS rebinding / a row edited after creation: bypass the creation-time check.
      await prisma.webhook.update({ where: { id }, data: { url: "https://127.0.0.1/internal" } });
      await writer.post(`${base}/issues`, { title: "rebind" });
      await settled(id, 1);
      const [delivery] = await deliveries(id);
      assert.equal(delivery!.status, "FAILED");
      assert.match(delivery!.lastError ?? "", /non-public/);
      assert.equal(sent.length, 0, "no request was attempted");
      await cleanup();
    });
  });

  describe("the real HTTPS transport", () => {
    async function withServer(
      handler: (
        request: IncomingMessage,
        respondWith: (status: number, body?: string, headers?: Record<string, string>) => void,
      ) => void,
      run: (port: number) => Promise<void>,
    ) {
      const seen: {
        method: string | undefined;
        url: string | undefined;
        headers: IncomingMessage["headers"];
        body: string;
      }[] = [];
      const server = createServer(
        { key: TEST_TLS_KEY, cert: TEST_TLS_CERT },
        (request, response) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            seen.push({
              method: request.method,
              url: request.url,
              headers: request.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
            handler(request, (status, body = "", headers = {}) => {
              response.writeHead(status, headers);
              response.end(body);
            });
          });
        },
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        await run((server.address() as AddressInfo).port);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      return seen;
    }

    const request = (port: number, host = "127.0.0.1"): WebhookRequest => ({
      address: "127.0.0.1",
      url: new URL(`https://${host}:${port}/hook?x=1`),
      body: '{"hello":"world"}',
      headers: { "content-type": "application/json", "x-nagar-signature-256": "sha256=abc" },
    });

    it("POSTs the body and headers to the pinned address and returns the status", async () => {
      const transport = createHttpsWebhookTransport({ ca: TEST_TLS_CERT });
      let status = 0;
      const seen = await withServer(
        (_request, respondWith) => respondWith(204),
        async (port) => {
          status = await transport(request(port));
        },
      );
      assert.equal(status, 204);
      assert.equal(seen[0]?.method, "POST");
      assert.equal(seen[0]?.url, "/hook?x=1");
      assert.equal(seen[0]?.body, '{"hello":"world"}');
      assert.equal(seen[0]?.headers["x-nagar-signature-256"], "sha256=abc");
      assert.match(seen[0]?.headers.host ?? "", /^127\.0\.0\.1:\d+$/);
    });

    it("verifies the certificate against the configured hostname, not the pinned address", async () => {
      const transport = createHttpsWebhookTransport({ ca: TEST_TLS_CERT });
      await withServer(
        (_request, respondWith) => respondWith(200),
        async (port) => {
          // `localhost` is in the certificate, so connecting to 127.0.0.1 as "localhost" is fine…
          assert.equal(await transport(request(port, "localhost")), 200);
          // …while a hostname the certificate does not cover must fail even though the pinned
          // address answers with a valid, trusted certificate.
          await assert.rejects(
            transport(request(port, "not-the-cert-name.test")),
            /altnames|match|Hostname/i,
          );
        },
      );
    });

    it("rejects certificates it does not trust", async () => {
      const transport = createHttpsWebhookTransport(); // default trust store, not our fixture
      await withServer(
        (_request, respondWith) => respondWith(200),
        async (port) => {
          await assert.rejects(
            transport(request(port)),
            /self[- ]signed|unable to verify|certificate/i,
          );
        },
      );
    });

    it("does not follow redirects and caps what it reads", async () => {
      const transport = createHttpsWebhookTransport({ ca: TEST_TLS_CERT });
      await withServer(
        (_request, respondWith) => respondWith(302, "", { location: "https://10.0.0.1/steal" }),
        async (port) => {
          assert.equal(await transport(request(port)), 302, "the 302 is reported, not followed");
        },
      );
      await withServer(
        (_request, respondWith) => respondWith(200, "x".repeat(200 * 1024)),
        async (port) => {
          await assert.rejects(transport(request(port)), /exceeded 64 KB|socket hang up|aborted/i);
        },
      );
    });
  });
});
