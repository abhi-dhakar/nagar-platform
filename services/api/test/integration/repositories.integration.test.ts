import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PASSWORD, integrationSuite, type ApiClient } from "./harness.js";

await integrationSuite("NagarHub core: repositories, Git transport, browsing", (harness) => {
  let alice: ApiClient;
  let bob: ApiClient;
  let anonymous: ApiClient;

  before(async () => {
    await harness.start();
    alice = await harness.user("alice");
    bob = await harness.user("bob");
    anonymous = harness.anonymous();
  });
  after(() => harness.stop());

  const repo = (owner: ApiClient, slug: string) => `/api/v1/repositories/${owner.username}/${slug}`;

  describe("creating repositories", () => {
    it("creates a public repository with a README, clone URL, and one commit", async () => {
      const response = await alice.post("/api/v1/repositories", {
        name: "Hello.World",
        description: "first repo",
        visibility: "PUBLIC",
      });
      assert.equal(response.status, 201);
      const created = response.json.data.repository;
      assert.equal(created.slug, "hello.world", "slugs are lower-cased");
      assert.match(created.cloneUrl, /\/git\/.+\/hello\.world\.git$/);
      assert.equal(created.defaultBranch, "main");
      assert.deepEqual(created.branches, ["main"]);
      assert.equal(created.commits.length, 1);
      assert.match(created.readme, /Hello\.World/);
      assert.doesNotMatch(response.text, /gitPath|ownerId/, "no internal storage details leak");
    });

    it("defaults to private and validates names, description, and visibility", async () => {
      const made = await alice.post("/api/v1/repositories", { name: "secret" });
      assert.equal(made.status, 201);
      assert.equal(made.json.data.repository.visibility, "PRIVATE");

      assert.equal((await alice.post("/api/v1/repositories", { name: "secret" })).status, 409);
      for (const name of ["bad name", "x.git", "..", "a/b", "", "-lead", "x".repeat(101)]) {
        const response = await alice.post("/api/v1/repositories", { name });
        assert.equal(response.status, 400, JSON.stringify(name));
      }
      assert.equal(
        (await alice.post("/api/v1/repositories", { name: "ok1", description: "x".repeat(351) }))
          .status,
        400,
      );
      assert.equal(
        (await alice.post("/api/v1/repositories", { name: "ok2", visibility: "INTERNAL" })).status,
        400,
      );
    });

    it("requires a session and a chosen username", async () => {
      assert.equal((await anonymous.post("/api/v1/repositories", { name: "nope" })).status, 401);
      const drifter = await harness.userWithoutUsername("drifter");
      const response = await drifter.post("/api/v1/repositories", { name: "nope" });
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, "PROFILE_REQUIRED");
    });

    it("supports a repository without a README", async () => {
      const response = await alice.post("/api/v1/repositories", {
        name: "bare",
        initializeWithReadme: false,
      });
      assert.equal(response.status, 201);
      const created = response.json.data.repository;
      assert.deepEqual(created.branches, []);
      assert.deepEqual(created.files, []);
      assert.equal(created.readme, null);
    });
  });

  describe("visibility", () => {
    it("hides private repositories from everyone without access", async () => {
      assert.equal((await alice.get(repo(alice, "secret"))).status, 200);
      assert.equal((await anonymous.get(repo(alice, "secret"))).status, 404);
      assert.equal((await bob.get(repo(alice, "secret"))).status, 404);
      for (const path of ["commits", "branches", "contents", "issues", "pulls"]) {
        assert.equal((await bob.get(`${repo(alice, "secret")}/${path}`)).status, 404, path);
      }
      assert.equal(
        (await anonymous.get(`${repo(alice, "secret")}/compare?base=main&head=main`)).status,
        404,
      );
    });

    it("serves public repositories to anyone", async () => {
      assert.equal((await anonymous.get(repo(alice, "hello.world"))).status, 200);
      assert.equal((await anonymous.get(`${repo(alice, "hello.world")}/commits`)).status, 200);
    });

    it("lists the repositories a person can work on, with their role", async () => {
      const carol = await harness.user("carol");
      const team = harness.orgSlug("carolsteam");
      await carol.post("/api/v1/organizations", { name: "Carol's Team", slug: team });
      await carol.post(`/api/v1/organizations/${team}/repositories`, { name: "team-repo" });
      await carol.post("/api/v1/repositories", { name: "mine", visibility: "PRIVATE" });
      await alice.post(`${repo(alice, "secret")}/collaborators`, {
        username: carol.username,
        role: "READ",
      });
      await carol.post(`/api/v1/organizations/${team}/members`, {
        username: bob.username,
        role: "MEMBER",
      });

      const list = async (client: ApiClient) =>
        new Map<string, { role: string; namespaceType: string; owner: string }>(
          (await client.get("/api/v1/repositories")).json.data.repositories.map(
            (item: { owner: string; slug: string; role: string; namespaceType: string }) => [
              `${item.owner}/${item.slug}`,
              item,
            ],
          ),
        );
      const forCarol = await list(carol);
      assert.equal(forCarol.get(`${carol.username}/mine`)?.role, "ADMIN");
      assert.equal(forCarol.get(`${team}/team-repo`)?.namespaceType, "ORGANIZATION");
      assert.equal(forCarol.get(`${alice.username}/secret`)?.role, "READ", "shared with her");
      const forBob = await list(bob);
      assert.equal(forBob.get(`${team}/team-repo`)?.role, "WRITE", "org member");
      assert.equal(forBob.has(`${carol.username}/mine`), false, "someone else's private repo");
      assert.equal(forBob.has(`${alice.username}/secret`), false);
      assert.equal((await anonymous.get("/api/v1/repositories")).status, 401);
    });
  });

  describe("Git over HTTP", () => {
    it("lets anyone clone a public repository, but not push", async () => {
      const clone = await harness.clone(alice.username, "hello.world");
      assert.ok(clone.ok, clone.err);
      assert.match(readFileSync(join(clone.dir, "README.md"), "utf8"), /Hello\.World/);
      await harness.commit(clone.dir, "anon.txt", "x\n", "feat: anonymous");
      assert.equal((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok, false);
    });

    it("requires credentials for private repositories and rejects wrong ones", async () => {
      assert.equal((await harness.clone(alice.username, "secret")).ok, false, "anonymous");
      assert.equal((await harness.clone(alice.username, "secret", bob)).ok, false, "no access");
      assert.equal(
        (await harness.clone(alice.username, "secret", alice, "wrong-password-123")).ok,
        false,
      );
      const clone = await harness.clone(alice.username, "secret", alice);
      assert.ok(clone.ok, clone.err);
    });

    it("pushes commits and branches, and the API reflects them immediately", async () => {
      const clone = await harness.clone(alice.username, "hello.world", alice);
      await harness.commit(clone.dir, "src/app.ts", "export const answer = 42;\n", "feat: add app");
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);
      await harness.git(["checkout", "-b", "feature/login"], { cwd: clone.dir });
      await harness.commit(clone.dir, "login.txt", "login\n", "feat: login");
      assert.ok((await harness.git(["push", "origin", "feature/login"], { cwd: clone.dir })).ok);

      const summary = (await anonymous.get(repo(alice, "hello.world"))).json.data.repository;
      assert.equal(summary.commits[0].message, "feat: add app");
      assert.deepEqual([...summary.branches].sort(), ["feature/login", "main"]);
      assert.ok(
        summary.files.some(
          (f: { name: string; kind: string }) => f.name === "src" && f.kind === "directory",
        ),
      );

      const onBranch = await anonymous.get(`${repo(alice, "hello.world")}?ref=feature/login`);
      assert.equal(onBranch.json.data.repository.commits[0].message, "feat: login");
      assert.equal((await anonymous.get(`${repo(alice, "hello.world")}?ref=ghost`)).status, 404);
    });

    it("takes the first push into an empty repository", async () => {
      const clone = await harness.clone(alice.username, "bare", alice);
      assert.ok(clone.ok, clone.err);
      await harness.commit(clone.dir, "README.md", "# Empty no more\n", "chore: first commit");
      await harness.git(["branch", "-M", "main"], { cwd: clone.dir });
      assert.ok((await harness.git(["push", "-u", "origin", "main"], { cwd: clone.dir })).ok);
      const summary = (await alice.get(repo(alice, "bare"))).json.data.repository;
      assert.deepEqual(summary.branches, ["main"]);
      assert.match(summary.readme, /Empty no more/);
    });

    it("does not accept a push to someone else's repository, even with valid credentials", async () => {
      const clone = await harness.clone(alice.username, "hello.world", bob);
      await harness.commit(clone.dir, "evil.txt", "x\n", "feat: bob without access");
      const pushed = await harness.git(["push", "origin", "main"], { cwd: clone.dir });
      assert.equal(pushed.ok, false);
      assert.match(pushed.err, /403|denied|forbidden/i);
    });
  });

  describe("browsing: contents, blobs, history, branches, compare", () => {
    it("lists directories and returns file contents with safe paths only", async () => {
      const contents = await anonymous.get(
        `${repo(alice, "hello.world")}/contents?ref=main&path=src`,
      );
      assert.deepEqual(
        contents.json.data.entries.map((entry: { name: string }) => entry.name),
        ["app.ts"],
      );
      const blob = await anonymous.get(
        `${repo(alice, "hello.world")}/blob?ref=main&path=src/app.ts`,
      );
      assert.equal(blob.json.data.content, "export const answer = 42;\n");
      assert.equal(blob.json.data.size, 26);
      for (const bad of ["../../etc/passwd", "/etc/passwd", "a//b", "a\\b"]) {
        const response = await anonymous.get(
          `${repo(alice, "hello.world")}/blob?ref=main&path=${encodeURIComponent(bad)}`,
        );
        assert.equal(response.status, 400, bad);
      }
      const injected = await anonymous.get(
        `${repo(alice, "hello.world")}/blob?ref=${encodeURIComponent("--upload-pack=evil")}&path=README.md`,
      );
      assert.equal(injected.status, 404, "an option-looking ref is just an unknown branch");
      assert.equal(
        (await anonymous.get(`${repo(alice, "hello.world")}/blob?ref=main&path=missing.txt`))
          .status,
        404,
      );
    });

    it("tells the client when a file is binary or too large to preview", async () => {
      const clone = await harness.clone(alice.username, "hello.world", alice);
      await harness.commit(
        clone.dir,
        "assets/logo.bin",
        Buffer.from([0, 1, 2, 0, 255]),
        "feat: binary",
      );
      await harness.commit(
        clone.dir,
        "big.txt",
        Buffer.alloc(1024 * 1024 + 1, 97),
        "feat: big file",
      );
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);

      const binary = await anonymous.get(
        `${repo(alice, "hello.world")}/blob?ref=main&path=assets/logo.bin`,
      );
      assert.equal(binary.status, 200);
      assert.equal(binary.json.data.binary, true);
      assert.equal(binary.json.data.content, null);
      const big = await anonymous.get(`${repo(alice, "hello.world")}/blob?ref=main&path=big.txt`);
      assert.equal(big.json.data.tooLarge, true);
      assert.equal(big.json.data.content, null);
    });

    it("pages through full commit history with totals", async () => {
      const clone = await harness.clone(alice.username, "hello.world", alice);
      for (let index = 1; index <= 32; index++)
        await harness.commit(
          clone.dir,
          `history/${index}.txt`,
          `${index}\n`,
          `chore: history ${index}`,
        );
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);

      const base = `${repo(alice, "hello.world")}/commits`;
      const first = (await anonymous.get(`${base}?perPage=30`)).json.data;
      assert.equal(first.commits.length, 30);
      assert.equal(first.hasMore, true);
      assert.equal(first.ref, "main");
      assert.equal(first.commits[0].message, "chore: history 32");
      const second = (await anonymous.get(`${base}?perPage=30&page=2`)).json.data;
      assert.equal(second.commits.length, first.total - 30);
      assert.equal(second.hasMore, false);
      assert.equal(second.commits.at(-1).message, "docs: initialize repository");
      const feature = (await anonymous.get(`${base}?ref=feature/login`)).json.data;
      assert.equal(feature.commits[0].message, "feat: login");

      assert.equal((await anonymous.get(`${base}?page=0`)).status, 400);
      assert.equal((await anonymous.get(`${base}?perPage=1000`)).status, 400);
      assert.equal((await anonymous.get(`${base}?page=abc`)).status, 400);
      assert.equal((await anonymous.get(`${base}?ref=ghost`)).status, 404);
    });

    it("answers with an empty history for an empty repository", async () => {
      const empty = await alice.post("/api/v1/repositories", {
        name: "nothing-yet",
        initializeWithReadme: false,
      });
      assert.equal(empty.status, 201);
      const history = await alice.get(`${repo(alice, "nothing-yet")}/commits`);
      assert.deepEqual(history.json.data, {
        ref: null,
        page: 1,
        perPage: 30,
        total: 0,
        hasMore: false,
        commits: [],
      });
      const branches = await alice.get(`${repo(alice, "nothing-yet")}/branches`);
      assert.deepEqual(
        branches.json.data,
        { defaultBranch: "main", branches: [] },
        "HEAD already names main; no branch exists until the first push",
      );
    });

    it("lists branches with their tip commit, default first", async () => {
      const response = await anonymous.get(`${repo(alice, "hello.world")}/branches`);
      assert.equal(response.status, 200);
      const { defaultBranch, branches } = response.json.data;
      assert.equal(defaultBranch, "main");
      assert.equal(branches[0].name, "main");
      assert.equal(branches[0].isDefault, true);
      const feature = branches.find((branch: { name: string }) => branch.name === "feature/login");
      assert.equal(feature.message, "feat: login");
      assert.match(feature.sha, /^[0-9a-f]{40}$/);
    });

    it("compares two branches for review", async () => {
      const response = await anonymous.get(
        `${repo(alice, "hello.world")}/compare?base=main&head=feature/login`,
      );
      assert.equal(response.status, 200);
      const { comparison } = response.json.data;
      assert.equal(comparison.ahead, 1);
      assert.ok(comparison.files.some((file: { path: string }) => file.path === "login.txt"));
      assert.match(comparison.diff, /^\+login$/m);
      assert.equal(
        (await anonymous.get(`${repo(alice, "hello.world")}/compare?base=main&head=ghost`)).status,
        404,
      );
      assert.equal(
        (await anonymous.get(`${repo(alice, "hello.world")}/compare?base=main`)).status,
        400,
      );
    });
  });

  it("keeps the password out of every Git and API response", async () => {
    const clone = await harness.clone(alice.username, "secret", alice);
    assert.ok(clone.ok);
    const config = await harness.git(["config", "--get", "remote.origin.url"], { cwd: clone.dir });
    assert.ok(config.out.includes(encodeURIComponent(PASSWORD)), "sanity: git stored our URL");
    const summary = await alice.get(repo(alice, "secret"));
    assert.doesNotMatch(summary.text, new RegExp(PASSWORD));
  });
});
