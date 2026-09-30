import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeRepositoryPath,
  normalizeRepositorySlug,
  normalizeUsername,
} from "../src/modules/repositories/validation.js";

describe("NagarHub input validation", () => {
  it("normalizes public usernames and repository slugs", () => {
    assert.equal(normalizeUsername("  Ada-Lovelace  "), "ada-lovelace");
    assert.equal(normalizeRepositorySlug("Hello.World"), "hello.world");
    assert.equal(normalizeRepositorySlug("nagar.git"), null);
  });

  it("rejects unsafe paths instead of passing traversal to Git", () => {
    assert.equal(normalizeRepositoryPath("src/lib"), "src/lib");
    assert.equal(normalizeRepositoryPath("../secrets"), null);
    assert.equal(normalizeRepositoryPath("src//app.ts"), null);
    assert.equal(normalizeRepositoryPath("/etc/passwd"), null);
  });
});
