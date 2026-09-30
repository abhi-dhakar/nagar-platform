import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PASSWORD, integrationSuite, type ApiClient } from "./harness.js";

// By default the API does not trust X-Forwarded-For, so a client cannot dodge the throttle (or
// frame someone else's address) by sending that header.
await integrationSuite("Git credential throttle without a trusted proxy", (harness) => {
  let owner: ApiClient;
  let url = "";

  before(async () => {
    delete process.env.TRUST_PROXY;
    await harness.start();
    owner = await harness.user("untrusted");
    await owner.post("/api/v1/repositories", { name: "vault", visibility: "PRIVATE" });
    url = `${harness.baseUrl}/git/${owner.username}/vault.git/info/refs?service=git-upload-pack`;
  });
  after(() => harness.stop());

  const attempt = (password: string, spoofedAddress: string) =>
    fetch(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${owner.email}:${password}`).toString("base64")}`,
        "x-forwarded-for": spoofedAddress,
      },
    });

  it("ignores a spoofed X-Forwarded-For, so rotating it does not reset the throttle", async () => {
    for (let index = 0; index < 12; index++) {
      assert.equal((await attempt(`wrong-password-${index}`, `198.51.100.${index}`)).status, 401);
    }
    assert.equal((await attempt(PASSWORD, "198.51.100.200")).status, 401, "still locked out");
  });
});
