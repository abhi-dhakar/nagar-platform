import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import {
  ApiClient,
  PASSWORD,
  RUN,
  WEB_ORIGIN,
  integrationSuite,
  redisReachable,
} from "./harness.js";

await integrationSuite("Foundation: API, database, sessions, profile", (harness) => {
  before(() => harness.start());
  after(() => harness.stop());

  it("liveness does not need dependencies and returns the typed envelope", async () => {
    const response = await harness.anonymous().get("/api/v1/health");
    assert.equal(response.status, 200);
    assert.equal(response.json.success, true);
    assert.equal(response.json.data.service, "nagar-api");
  });

  it("readiness reflects PostgreSQL and Redis", async () => {
    const response = await harness.anonymous().get("/api/v1/ready");
    if (await redisReachable()) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { success: true, data: { status: "ready" } });
    } else {
      assert.equal(response.status, 503);
      assert.equal(response.json.error.code, "DEPENDENCY_UNAVAILABLE");
    }
  });

  it("registers an account, starts a session, and exposes only safe fields", async () => {
    const client = await harness.userWithoutUsername("ada");
    assert.ok(client.jar.size > 0, "a session cookie was issued");
    const me = await client.get("/api/v1/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.data.user.email, client.email);
    assert.equal(me.json.data.user.username, null, "the username is chosen separately");
    assert.doesNotMatch(me.text, /password|token|secret/i);
  });

  it("enforces password length and unique email", async () => {
    const weak = await harness.anonymous().post("/api/auth/sign-up/email", {
      name: "Weak",
      email: `weak-${RUN}@example.test`,
      password: "short",
    });
    assert.ok(weak.status >= 400 && weak.status < 500, `status ${weak.status}`);

    const existing = await harness.user("grace");
    const duplicate = await harness.anonymous().post("/api/auth/sign-up/email", {
      name: "Again",
      email: existing.email,
      password: PASSWORD,
    });
    assert.ok(duplicate.status >= 400 && duplicate.status < 500, `status ${duplicate.status}`);
  });

  it("rejects sign-up requests from an untrusted origin (CSRF)", async () => {
    const response = await harness
      .anonymous()
      .request(
        "POST",
        "/api/auth/sign-up/email",
        { name: "Evil", email: `evil-${RUN}@example.test`, password: PASSWORD },
        { origin: "https://evil.example" },
      );
    assert.equal(response.status, 403);
  });

  it("signs in, signs out, and revokes the session", async () => {
    const account = await harness.user("linus");
    const session = new ApiClient(harness.baseUrl, "second-device");

    const wrong = await session.post("/api/auth/sign-in/email", {
      email: account.email,
      password: "definitely-not-the-password",
    });
    assert.equal(wrong.status, 401);

    const ok = await session.post("/api/auth/sign-in/email", {
      email: account.email,
      password: PASSWORD,
    });
    assert.equal(ok.status, 200);
    assert.equal((await session.get("/api/v1/me")).status, 200);

    assert.equal((await session.post("/api/auth/sign-out", {})).status, 200);
    assert.equal((await session.get("/api/v1/me")).status, 401);
    assert.equal((await account.get("/api/v1/me")).status, 200, "other sessions are unaffected");
  });

  it("validates and protects the public profile", async () => {
    const owner = await harness.user("margaret");
    const other = await harness.user("katherine");

    const updated = await owner.patch("/api/v1/me/profile", {
      name: "Margaret H.",
      bio: "Flight software",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.user.bio, "Flight software");

    const taken = await other.patch("/api/v1/me/profile", { username: owner.username });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error.code, "USERNAME_TAKEN");

    for (const invalid of ["a", "-bad", "bad-", "UPPER_case", "has space", "x".repeat(40), "ünï"]) {
      const response = await other.patch("/api/v1/me/profile", { username: invalid });
      assert.equal(response.status, 400, `username ${JSON.stringify(invalid)}`);
    }
    assert.equal((await other.patch("/api/v1/me/profile", { bio: "x".repeat(281) })).status, 400);
    assert.equal((await other.patch("/api/v1/me/profile", {})).status, 400);
    assert.equal(
      (await harness.anonymous().patch("/api/v1/me/profile", { bio: "hi" })).status,
      401,
    );
  });

  it("reserves names that would shadow Hub routes or API prefixes", async () => {
    const probe = await harness.user("reservedprobe");
    for (const name of ["api", "git", "login", "signup", "dashboard", "new", "settings", "admin"]) {
      const response = await probe.patch("/api/v1/me/profile", { username: name });
      assert.equal(response.status, 409, name);
      assert.equal(response.json.error.code, "NAMESPACE_RESERVED", name);
    }
    const org = await probe.post("/api/v1/organizations", { name: "API team", slug: "api" });
    assert.equal(org.status, 409);
    assert.equal(org.json.error.code, "NAMESPACE_RESERVED");
    // Ordinary names still work, and re-saving your own profile is never blocked.
    assert.equal((await probe.patch("/api/v1/me/profile", { name: "Probe" })).status, 200);
  });

  it("serves the public profile without private data", async () => {
    const owner = await harness.user("hedy");
    await owner.post("/api/v1/repositories", { name: "public-one", visibility: "PUBLIC" });
    await owner.post("/api/v1/repositories", { name: "private-one", visibility: "PRIVATE" });
    const profile = await harness.anonymous().get(`/api/v1/users/${owner.username}`);
    assert.equal(profile.status, 200);
    assert.deepEqual(
      profile.json.data.user.repositories.map((repo: { slug: string }) => repo.slug),
      ["public-one"],
    );
    assert.doesNotMatch(profile.text, /example\.test|email/i);
    assert.equal((await harness.anonymous().get("/api/v1/users/nobody-" + RUN)).status, 404);
  });

  it("uses one error envelope for malformed input, oversized bodies, and unknown routes", async () => {
    const client = await harness.user("errors");
    const invalidJson = await client.request("POST", "/api/v1/repositories", "{not json");
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.json.error.code, "INVALID_JSON");

    const tooLarge = await client.request("POST", "/api/v1/repositories", "x".repeat(2_000_000));
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.json.error.code, "PAYLOAD_TOO_LARGE");

    const missing = await client.get("/api/v1/no-such-route");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "NOT_FOUND");
  });

  it("answers CORS preflights only for configured web origins", async () => {
    const anonymous = harness.anonymous();
    const allowed = await anonymous.request("OPTIONS", "/api/v1/me", undefined, {
      origin: WEB_ORIGIN,
      "access-control-request-method": "GET",
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), WEB_ORIGIN);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    const denied = await anonymous.request("OPTIONS", "/api/v1/me", undefined, {
      origin: "https://evil.example",
      "access-control-request-method": "GET",
    });
    assert.notEqual(denied.headers.get("access-control-allow-origin"), "https://evil.example");
  });
});
