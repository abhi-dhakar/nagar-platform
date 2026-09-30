import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  diffRefs,
  GitStore,
  MergeConflictError,
  NothingToMergeError,
  runGit,
} from "../src/modules/git/git-store.js";

const key = "22222222-2222-4222-8222-222222222222.git";
let root = "";
let store: GitStore;
let work = "";

async function commit(file: string, contents: string | Buffer, message: string) {
  const target = join(work, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  await runGit(["add", "--all"], { cwd: work });
  await runGit(["commit", "-m", message], { cwd: work });
}
const push = (...refspecs: string[]) =>
  runGit(["push", "origin", ...refspecs], { cwd: work, timeoutMs: 60_000 });
const checkout = (...args: string[]) => runGit(["checkout", ...args], { cwd: work });

describe("GitStore against a real repository", () => {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "nagar-store-test-"));
    store = new GitStore(join(root, "data"));
    await store.createBare(key);
    await store.initializeReadme(key, "store-test");
    work = join(root, "work");
    await runGit(["clone", "--no-local", store.repositoryPath(key), work], { cwd: root });
    await runGit(["config", "user.name", "Store Test"], { cwd: work });
    await runGit(["config", "user.email", "store@example.test"], { cwd: work });
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects malformed repositories at push time (fsck) and enables receive-pack", async () => {
    const config = async (name: string) =>
      (await runGit(["--git-dir", store.repositoryPath(key), "config", name])).toString().trim();
    assert.equal(await config("receive.fsckObjects"), "true");
    assert.equal(await config("http.receivepack"), "true");
  });

  it("pages through commit history newest-first", async () => {
    for (let index = 1; index <= 35; index++)
      await commit(`history/${index}.txt`, `${index}\n`, `chore: commit ${index}`);
    await push("main");

    const first = await store.commitPage(key, "main", { skip: 0, limit: 30 });
    assert.equal(first.commits.length, 30);
    assert.equal(first.hasMore, true);
    assert.equal(first.commits[0]?.message, "chore: commit 35");
    assert.equal(first.commits[0]?.shortSha.length, 7);

    const second = await store.commitPage(key, "main", { skip: 30, limit: 30 });
    assert.equal(second.commits.length, 6, "35 commits + the initial README commit = 36");
    assert.equal(second.hasMore, false);
    assert.equal(second.commits.at(-1)?.message, "docs: initialize repository");

    assert.equal(await store.countCommits(key, "main"), 36);
    assert.deepEqual(await store.commitPage(key, "no-such-branch"), {
      commits: [],
      hasMore: false,
    });
    assert.equal((await store.commits(key, "main", 500)).length, 36, "limit is clamped to 50");
    assert.equal((await store.commits(key, "main", 5)).length, 5);
  });

  it("lists branches with their tip commit, default branch first", async () => {
    await checkout("-b", "feature/details");
    await commit("details.txt", "d\n", "feat: branch tip message");
    await push("feature/details");
    await checkout("main");

    assert.deepEqual((await store.branches(key)).sort(), ["feature/details", "main"]);
    const branches = await store.branchDetails(key);
    assert.equal(branches[0]?.name, "main");
    assert.equal(branches[0]?.isDefault, true);
    const feature = branches.find((branch) => branch.name === "feature/details");
    assert.equal(feature?.isDefault, false);
    assert.equal(feature?.message, "feat: branch tip message");
    assert.match(feature?.sha ?? "", /^[0-9a-f]{40}$/);
    assert.equal(feature?.author, "Store Test");
    assert.equal(await store.defaultBranch(key), "main");
  });

  it("compares branches: commits, file statuses, line counts, and a unified diff", async () => {
    await checkout("-b", "feature/compare", "main");
    await commit("compare/new.txt", "one\ntwo\nthree\n", "feat: add new file");
    await commit("README.md", "# rewritten\n", "docs: rewrite readme");
    await runGit(["rm", "history/1.txt"], { cwd: work });
    await runGit(["commit", "-m", "chore: drop a file"], { cwd: work });
    await commit("logo.bin", Buffer.from([0, 1, 2, 3, 0, 255]), "feat: add binary");
    await push("feature/compare");
    await checkout("main");

    const comparison = await store.compare(key, "main", "feature/compare");
    assert.ok(comparison);
    assert.equal(comparison.ahead, 4);
    assert.equal(comparison.behind, 0);
    assert.equal(comparison.commits.length, 4);
    assert.equal(comparison.commits[0]?.message, "feat: add binary");
    const byPath = new Map(comparison.files.map((file) => [file.path, file]));
    assert.deepEqual(
      {
        status: byPath.get("compare/new.txt")?.status,
        additions: byPath.get("compare/new.txt")?.additions,
      },
      { status: "added", additions: 3 },
    );
    assert.equal(byPath.get("README.md")?.status, "modified");
    assert.equal(byPath.get("history/1.txt")?.status, "deleted");
    assert.equal(byPath.get("history/1.txt")?.deletions, 1);
    assert.equal(byPath.get("logo.bin")?.binary, true);
    assert.equal(comparison.totals.files, 4);
    assert.match(comparison.diff, /^diff --git a\/README\.md b\/README\.md/m);
    assert.match(comparison.diff, /^\+# rewritten$/m);
    assert.match(comparison.diff, /Binary files .* differ/);
    assert.equal(comparison.diffTruncated, false);
    assert.ok(comparison.mergeBase);
  });

  it("compare accepts commit ids, reports branches that moved ahead, and rejects unknowns", async () => {
    const mainSha = (await runGit(["rev-parse", "main"], { cwd: work })).toString().trim();
    const featureSha = (await runGit(["rev-parse", "feature/compare"], { cwd: work }))
      .toString()
      .trim();
    const bySha = await store.compare(key, mainSha, featureSha);
    assert.equal(bySha?.ahead, 4);

    await checkout("main");
    await commit("main-only.txt", "m\n", "feat: main moves on");
    await push("main");
    const moved = await store.compare(key, "main", "feature/compare");
    assert.equal(moved?.ahead, 4);
    assert.equal(moved?.behind, 1);
    assert.equal(
      moved?.files.some((file) => file.path === "main-only.txt"),
      false,
      "three-dot diff",
    );

    assert.equal(await store.compare(key, "main", "does-not-exist"), null);
    assert.equal(await store.compare(key, "main", "0".repeat(40)), null);
    assert.equal(await store.compare(key, "--upload-pack=evil", "main"), null);
  });

  it("bounds very large diffs instead of failing", async () => {
    await checkout("-b", "feature/huge", "main");
    const line = "x".repeat(80);
    await commit("huge.txt", `${(line + "\n").repeat(8000)}`, "feat: large file");
    await push("feature/huge");
    await checkout("main");
    const comparison = await store.compare(key, "main", "feature/huge");
    assert.ok(comparison);
    assert.equal(comparison.diffTruncated, true);
    assert.ok(comparison.diff.length <= 400 * 1024);
    assert.equal(comparison.totals.additions, 8000, "totals stay exact when the text is cut");
    const added = comparison.diff.split("\n").filter((line) => line.startsWith("+x"));
    assert.ok(added.length > 100, "a meaningful amount of the diff is still returned");
    assert.ok(
      added.every((line) => line.length === 81),
      "the text is cut at a line boundary, never mid-line",
    );
  });

  it("compares unrelated histories without a merge base", async () => {
    await checkout("--orphan", "orphan");
    await runGit(["rm", "-rf", "."], { cwd: work });
    await commit("lonely.txt", "hi\n", "chore: unrelated root");
    await push("orphan");
    await checkout("main");
    const comparison = await store.compare(key, "main", "orphan");
    assert.equal(comparison?.mergeBase, null);
    assert.ok((comparison?.totals.files ?? 0) > 0);
  });

  it("classifies blobs as text, binary, too large, or missing", async () => {
    await checkout("main");
    await commit("notes/readme.txt", "hello\n", "docs: notes");
    await commit("assets/blob.bin", Buffer.from([0, 159, 146, 150]), "feat: binary asset");
    await commit("big.txt", Buffer.alloc(1024 * 1024 + 10, 97), "feat: too big to preview");
    await push("main");

    assert.deepEqual(await store.blob(key, "main", "notes/readme.txt"), {
      status: "ok",
      size: 6,
      content: "hello\n",
    });
    assert.deepEqual(await store.blob(key, "main", "assets/blob.bin"), {
      status: "binary",
      size: 4,
    });
    assert.equal((await store.blob(key, "main", "big.txt")).status, "too_large");
    assert.deepEqual(await store.blob(key, "main", "notes"), { status: "not_found" }, "directory");
    assert.deepEqual(await store.blob(key, "main", "missing.txt"), { status: "not_found" });
    assert.deepEqual(await store.blob(key, "nope", "notes/readme.txt"), { status: "not_found" });
    assert.equal(await store.textFile(key, "main", "assets/blob.bin"), null);
    assert.equal(await store.textFile(key, "main", "notes/readme.txt"), "hello\n");
  });

  it("snapshots refs and explains what a push changed", async () => {
    const before = await store.refSnapshot(key);
    await checkout("-b", "feature/snap", "main");
    await commit("snap.txt", "s\n", "feat: first snap commit");
    await commit("snap2.txt", "s\n", "feat: second snap commit");
    await checkout("main");
    await commit("snap-main.txt", "m\n", "feat: advance main");
    await runGit(["tag", "v0.1.0"], { cwd: work });
    await push("feature/snap", "main", "v0.1.0");
    const after = await store.refSnapshot(key);

    const updates = diffRefs(before, after);
    assert.deepEqual(
      updates.map((update) => [update.ref, update.before === null, update.after === null]),
      [
        ["refs/heads/feature/snap", true, false],
        ["refs/heads/main", false, false],
        ["refs/tags/v0.1.0", true, false],
      ],
    );
    const snap = updates.find((update) => update.ref === "refs/heads/feature/snap");
    const created = await store.newCommits(key, snap!.after!, [...before.values()]);
    assert.deepEqual(
      created.map((commit) => commit.message),
      ["feat: second snap commit", "feat: first snap commit"],
      "only commits no earlier ref had",
    );
    const main = updates.find((update) => update.ref === "refs/heads/main");
    const moved = await store.newCommits(key, main!.after!, [main!.before!]);
    assert.deepEqual(
      moved.map((commit) => commit.message),
      ["feat: advance main"],
    );

    await runGit(["push", "origin", ":feature/snap"], { cwd: work });
    const deleted = diffRefs(after, await store.refSnapshot(key));
    assert.deepEqual(deleted, [
      { ref: "refs/heads/feature/snap", before: snap!.after, after: null },
    ]);
    assert.deepEqual(diffRefs(after, after), [], "no change, no event");
    assert.deepEqual(await store.newCommits(key, "not-a-sha", []), []);
  });

  it("merges with a merge commit and leaves the base untouched on conflict", async () => {
    await checkout("main");
    await commit("conflict.txt", "base\n", "chore: conflict base");
    await push("main");
    await checkout("-b", "left");
    await commit("conflict.txt", "left\n", "feat: left side");
    await push("left");
    await checkout("main");
    await checkout("-b", "right");
    await commit("conflict.txt", "right\n", "feat: right side");
    await push("right");
    await checkout("main");
    await checkout("-b", "clean");
    await commit("clean.txt", "clean\n", "feat: clean change");
    await push("clean");
    await checkout("main");

    const cleanSha = await store.mergeBranches(key, "main", "clean");
    const head = (await store.commits(key, "main", 5))[0];
    assert.equal(head?.sha, cleanSha);
    assert.match(head?.message ?? "", /Merge .*clean/);
    assert.equal((await store.blob(key, "main", "clean.txt")).status, "ok");

    await store.mergeBranches(key, "main", "left");
    const before = (await store.refSnapshot(key)).get("refs/heads/main");
    await assert.rejects(store.mergeBranches(key, "main", "right"), (error: unknown) => {
      assert.ok(error instanceof MergeConflictError);
      assert.deepEqual(error.files, ["conflict.txt"]);
      return true;
    });
    assert.equal((await store.refSnapshot(key)).get("refs/heads/main"), before, "base unchanged");
  });

  it("reports a no-op merge instead of recording a bogus merge commit", async () => {
    await assert.rejects(store.mergeBranches(key, "main", "clean"), NothingToMergeError);
    await assert.rejects(store.mergeBranches(key, "main", "main"), /different/);
    await assert.rejects(store.mergeBranches(key, "main", "ghost"), /must exist/);
  });

  it("ignores the server operator's personal Git configuration", async () => {
    const home = join(root, "hostile-home");
    await mkdir(home, { recursive: true });
    // If this were honored, every commit Nagar makes would try to GPG-sign with a failing program.
    await writeFile(
      join(home, ".gitconfig"),
      "[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /bin/false\n[init]\n\tdefaultBranch = trunk\n",
    );
    const saved = {
      HOME: process.env.HOME,
      XDG: process.env.XDG_CONFIG_HOME,
      USERPROFILE: process.env.USERPROFILE,
    };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.XDG_CONFIG_HOME;
    try {
      const isolated = "33333333-3333-4333-8333-333333333333.git";
      await store.createBare(isolated);
      await store.initializeReadme(isolated, "isolated");
      assert.equal(await store.defaultBranch(isolated), "main");
      assert.equal(
        (await store.commits(isolated, "main"))[0]?.message,
        "docs: initialize repository",
      );
      assert.match(await readFile(join(home, ".gitconfig"), "utf8"), /gpgsign/);
    } finally {
      for (const [name, value] of Object.entries({
        HOME: saved.HOME,
        XDG_CONFIG_HOME: saved.XDG,
        USERPROFILE: saved.USERPROFILE,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
