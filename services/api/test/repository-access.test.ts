import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessRepository,
  repositoryRole,
} from "../src/modules/repositories/repository-access.js";

test("repository access keeps public reads open without granting writes", async () => {
  const repository = {
    id: "repo",
    ownerId: null,
    organizationId: "org",
    visibility: "PUBLIC" as const,
  };
  assert.equal(await canAccessRepository(repository, null, "READ"), true);
  assert.equal(await canAccessRepository(repository, null, "WRITE"), false);
  assert.equal(await repositoryRole("repo", null, "org", null), null);
});

test("private repositories require an authenticated collaborator", async () => {
  const repository = {
    id: "repo",
    ownerId: "owner",
    organizationId: null,
    visibility: "PRIVATE" as const,
  };
  assert.equal(await canAccessRepository(repository, null), false);
});
