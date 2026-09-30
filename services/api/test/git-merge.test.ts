import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitStore, runGit } from "../src/modules/git/git-store.js";

test("approved pull-request merge updates the bare repository base branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "nagar-merge-test-"));
  const storageKey = "12345678-1234-4234-8234-123456789012.git";
  const store = new GitStore(join(root, "data"));
  const checkout = join(root, "checkout");
  try {
    await store.createBare(storageKey);
    await store.initializeReadme(storageKey, "merge-test");
    await runGit(["clone", "--no-local", store.repositoryPath(storageKey), checkout], {
      cwd: root,
    });
    await runGit(["config", "user.name", "Phase Two"], { cwd: checkout });
    await runGit(["config", "user.email", "phase-two@nagar.dev"], { cwd: checkout });
    await runGit(["checkout", "-b", "feature/collaboration"], { cwd: checkout });
    const readme = await readFile(join(checkout, "README.md"), "utf8");
    await writeFile(join(checkout, "README.md"), `${readme}\nPull requests are merged safely.\n`);
    await runGit(["add", "README.md"], { cwd: checkout });
    await runGit(["commit", "-m", "docs: add collaboration note"], { cwd: checkout });
    await runGit(["push", "origin", "feature/collaboration"], { cwd: checkout });

    const mergeSha = await store.mergeBranches(storageKey, "main", "feature/collaboration");
    const mainCommits = await store.commits(storageKey, "main", 10);
    assert.equal(mainCommits[0]?.sha, mergeSha);
    assert.match(mainCommits[0]?.message ?? "", /Merge .*feature\/collaboration/);
    assert.ok(mainCommits.some((commit) => commit.message.includes("collaboration note")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
