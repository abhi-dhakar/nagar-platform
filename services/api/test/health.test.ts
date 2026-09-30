import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiServer } from "../src/app.js";

const app = await createApiServer();

before(async () => {
  await app.ready();
});

after(async () => {
  await app.close();
});

describe("API foundation routes", () => {
  it("returns a typed liveness envelope without needing database availability", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.service, "nagar-api");
    assert.equal(body.data.status, "ok");
    assert.equal(typeof body.data.timestamp, "string");
  });

  it("registers the phase-two collaboration surface", () => {
    const routes = [
      ["GET", "/api/v1/repositories/:username/:repository/issues"],
      ["POST", "/api/v1/repositories/:username/:repository/issues"],
      ["GET", "/api/v1/repositories/:username/:repository/pulls"],
      ["POST", "/api/v1/repositories/:username/:repository/pulls/:number/reviews"],
      ["GET", "/api/v1/repositories/:username/:repository/collaborators"],
      ["POST", "/api/v1/repositories/:username/:repository/webhooks"],
      ["GET", "/api/v1/organizations"],
      ["GET", "/api/v1/notifications"],
    ];
    for (const [method, url] of routes)
      assert.equal(app.hasRoute({ method: method!, url: url! }), true, `${method} ${url}`);
  });

  it("protects the current-user route when no session cookie is present", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
  });
});
