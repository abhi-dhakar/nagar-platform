import assert from "node:assert/strict";
import test from "node:test";
import { partitionRepositories } from "./repositories";

const repo = (owner: string | null, namespaceType: "USER" | "ORGANIZATION", slug: string) => ({
  owner,
  namespaceType,
  slug,
});

test("a person's own repositories are separated from ones shared with them", () => {
  const list = [
    repo("ada", "USER", "engine"),
    repo("ada", "USER", "notes"),
    repo("grace", "USER", "compiler"),
    repo("acme", "ORGANIZATION", "platform"),
  ];
  const { mine, shared } = partitionRepositories(list, "ada");
  assert.deepEqual(
    mine.map((r) => r.slug),
    ["engine", "notes"],
  );
  assert.deepEqual(
    shared.map((r) => r.slug),
    ["compiler", "platform"],
  );
});

test("an organization that shares the person's name is still not 'mine'", () => {
  const { mine, shared } = partitionRepositories([repo("ada", "ORGANIZATION", "x")], "ada");
  assert.equal(mine.length, 0);
  assert.equal(shared.length, 1);
});

test("before the profile has loaded nothing is presumed to be owned", () => {
  const { mine, shared } = partitionRepositories([repo("ada", "USER", "x")], undefined);
  assert.equal(mine.length, 0);
  assert.equal(shared.length, 1);
});
