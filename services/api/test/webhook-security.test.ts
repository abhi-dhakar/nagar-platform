import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  lookupPublicWebhook,
  validateWebhookUrl,
  verifyWebhookSignature,
  webhookSignature,
} from "../src/modules/collaboration/crypto.js";

test("webhook signatures are HMAC SHA-256 and are compared safely", () => {
  const secret = "phase-two-secret";
  const payload = JSON.stringify({ event: "issues.opened", id: "delivery-1" });
  const signature = webhookSignature(secret, payload);
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(verifyWebhookSignature(secret, payload, signature), true);
  assert.equal(verifyWebhookSignature(secret, `${payload} `, signature), false);
  assert.equal(verifyWebhookSignature("other-secret", payload, signature), false);
});

test("webhook secrets are encrypted at rest with authenticated encryption", () => {
  const previous = process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY;
  process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY = "a4".repeat(32);
  try {
    const secret = "only-shown-once";
    const encrypted = encryptWebhookSecret(secret);
    assert.notEqual(encrypted.secretCiphertext, secret);
    assert.equal(decryptWebhookSecret(encrypted), secret);
    assert.throws(() => decryptWebhookSecret({ ...encrypted, secretTag: "invalid" }));
  } finally {
    if (previous === undefined) delete process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY;
    else process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY = previous;
  }
});

test("webhook targets reject insecure schemes and non-public addresses", async () => {
  assert.equal(await validateWebhookUrl("http://example.com/hook"), null);
  assert.equal(await validateWebhookUrl("https://localhost/hook"), null);
  assert.equal(await validateWebhookUrl("https://127.0.0.1/hook"), null);
  assert.equal(await validateWebhookUrl("https://[::1]/hook"), null);
  assert.equal(await lookupPublicWebhook("https://[0:0:0:0:0:0:0:1]/hook"), null);
  assert.equal(await lookupPublicWebhook("https://[::ffff:127.0.0.1]/hook"), null);
  assert.equal(await lookupPublicWebhook("https://192.168.1.4/hook"), null);
  assert.deepEqual(await lookupPublicWebhook("https://8.8.8.8/hook"), {
    address: "8.8.8.8",
    family: 4,
  });
});
