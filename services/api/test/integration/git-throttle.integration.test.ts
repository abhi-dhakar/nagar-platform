import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PASSWORD, integrationSuite, type ApiClient } from "./harness.js";

// The throttle is in-process state keyed by client address, so this file gets its own process
// (the test runner isolates files) and cannot lock out any other suite.
await integrationSuite("Git credential throttle behind a trusted proxy", (harness) => {
  let owner: ApiClient;
  let url = "";

  before(async () => {
    process.env.TRUST_PROXY = "true"; // the client address comes from X-Forwarded-For
    await harness.start();
    owner = await harness.user("throttled");
    await owner.post("/api/v1/repositories", { name: "vault", visibility: "PRIVATE" });
    url = `${harness.baseUrl}/git/${owner.username}/vault.git/info/refs?service=git-upload-pack`;
  });
  after(() => harness.stop());

  const attempt = (password: string, clientAddress: string) =>
    fetch(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${owner.email}:${password}`).toString("base64")}`,
        "x-forwarded-for": clientAddress,
      },
    });

  it("challenges anonymous access with a Basic realm", async () => {
    const response = await fetch(url);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /^Basic realm="Nagar Git"/);
  });

  it("locks one address out after repeated failures, without affecting others", async () => {
    assert.equal((await attempt(PASSWORD, "203.0.113.50")).status, 200, "valid credentials work");
    for (let index = 0; index < 12; index++) {
      assert.equal((await attempt(`wrong-password-${index}`, "203.0.113.50")).status, 401);
    }
    assert.equal(
      (await attempt(PASSWORD, "203.0.113.50")).status,
      401,
      "even the right password is refused while the address is locked out",
    );
    assert.equal(
      (await attempt(PASSWORD, "203.0.113.77")).status,
      200,
      "a different client address is unaffected",
    );
  });
});
