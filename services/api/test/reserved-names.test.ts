import assert from "node:assert/strict";
import test from "node:test";
import { isReservedNamespace } from "../src/lib/reserved-names.js";

test("names that collide with Hub routes or API prefixes are reserved", () => {
  for (const name of ["api", "git", "login", "signup", "dashboard", "new", "settings"]) {
    assert.equal(isReservedNamespace(name), true, name);
  }
  for (const name of ["organizations", "notifications", "admin", "nagar", "issues", "pulls"]) {
    assert.equal(isReservedNamespace(name), true, name);
  }
});

test("reserved-name matching ignores case and surrounding whitespace", () => {
  assert.equal(isReservedNamespace("  API "), true);
  assert.equal(isReservedNamespace("Login"), true);
});

test("ordinary names are not reserved", () => {
  for (const name of ["ada-lovelace", "acme", "my-team", "gitlab-fan", "apiary"]) {
    assert.equal(isReservedNamespace(name), false, name);
  }
});
