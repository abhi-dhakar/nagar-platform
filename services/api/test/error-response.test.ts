import assert from "node:assert/strict";
import test from "node:test";
import { notFoundResponse, toErrorResponse } from "../src/lib/error-response.js";
import { parseTrustProxy } from "../src/lib/trust-proxy.js";

const fastifyError = (code: string, statusCode: number) => ({ code, statusCode, message: "x" });

test("client mistakes keep their status and get a specific stable code", () => {
  assert.deepEqual(toErrorResponse(fastifyError("FST_ERR_CTP_INVALID_JSON_BODY", 400)), {
    status: 400,
    body: {
      success: false,
      error: { code: "INVALID_JSON", message: "The request body must be valid JSON." },
    },
  });
  assert.equal(
    toErrorResponse(fastifyError("FST_ERR_CTP_BODY_TOO_LARGE", 413)).body.error.code,
    "PAYLOAD_TOO_LARGE",
  );
  assert.equal(toErrorResponse(fastifyError("FST_ERR_CTP_INVALID_MEDIA_TYPE", 415)).status, 415);
  assert.equal(toErrorResponse(fastifyError("OTHER", 429)).body.error.code, "RATE_LIMITED");
  assert.equal(toErrorResponse(fastifyError("OTHER", 418)).body.error.code, "BAD_REQUEST");
});

test("server faults never leak details", () => {
  const response = toErrorResponse(
    new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"),
  );
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(response.body), /hunter2|ECONNREFUSED/);
  assert.equal(toErrorResponse(fastifyError("X", 503)).status, 500);
  assert.equal(toErrorResponse(null).status, 500);
});

test("unknown routes use the same envelope", () => {
  assert.deepEqual(notFoundResponse().body, {
    success: false,
    error: { code: "NOT_FOUND", message: "The requested resource was not found." },
  });
});

test("TRUST_PROXY is conservative by default and parses hop counts and address lists", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("0"), false);
  assert.equal(parseTrustProxy("true"), true);
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 192.168.1.1"), ["10.0.0.0/8", "192.168.1.1"]);
  const twoHops = parseTrustProxy("2");
  assert.equal(typeof twoHops, "function");
  if (typeof twoHops === "function") {
    assert.equal(twoHops("1.1.1.1", 0), true);
    assert.equal(twoHops("1.1.1.1", 1), true);
    assert.equal(twoHops("1.1.1.1", 2), false);
  }
});
