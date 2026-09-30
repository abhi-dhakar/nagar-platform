import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessRepository,
  effectiveRole,
  repositoryRole,
  roleAtLeast,
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

test("the owner is always an admin", () => {
  assert.equal(effectiveRole({ isOwner: true }), "ADMIN");
  assert.equal(effectiveRole({ isOwner: true, collaboratorRole: "READ" }), "ADMIN");
});

test("organization roles map to repository roles", () => {
  assert.equal(effectiveRole({ isOwner: false, organizationRole: "MEMBER" }), "WRITE");
  assert.equal(effectiveRole({ isOwner: false, organizationRole: "ADMIN" }), "ADMIN");
  assert.equal(effectiveRole({ isOwner: false, organizationRole: "OWNER" }), "ADMIN");
});

test("the highest of organization and collaborator roles wins", () => {
  assert.equal(
    effectiveRole({ isOwner: false, organizationRole: "MEMBER", collaboratorRole: "ADMIN" }),
    "ADMIN",
  );
  assert.equal(
    effectiveRole({ isOwner: false, organizationRole: "MEMBER", collaboratorRole: "READ" }),
    "WRITE",
  );
  assert.equal(effectiveRole({ isOwner: false, collaboratorRole: "READ" }), "READ");
  assert.equal(effectiveRole({ isOwner: false }), null);
});

test("role comparison is ordered READ < WRITE < ADMIN", () => {
  assert.equal(roleAtLeast("READ", "WRITE"), false);
  assert.equal(roleAtLeast("WRITE", "WRITE"), true);
  assert.equal(roleAtLeast("ADMIN", "WRITE"), true);
  assert.equal(roleAtLeast(null, "READ"), false);
});
