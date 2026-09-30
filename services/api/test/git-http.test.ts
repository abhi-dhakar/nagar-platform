import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitStore, runGit } from "../src/modules/git/git-store.js";
import { runGitHttpBackend } from "../src/modules/git/git-http.js";

const root = await mkdtemp(join(tmpdir(), "nagar-git-test-"));
const store = new GitStore(root);
const storageKey = "11000000-0000-4000-8000-000000000001.git";
const cloneDirectory = join(root, "clone");

const server = createServer((request, response) => {
  const incomingUrl = new URL(request.url ?? "/", "http://localhost");
  const routePrefix = "/fixture.git/";
  if (!incomingUrl.pathname.startsWith(routePrefix)) {
    response.writeHead(404).end();
    return;
  }
  const tail = incomingUrl.pathname.slice(routePrefix.length);
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", async () => {
    try {
      const backend = await runGitHttpBackend({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        pathInfo: `/${storageKey}/${tail}`,
        projectRoot: root,
        headers: request.headers,
        body: Buffer.concat(chunks),
        remoteAddress: request.socket.remoteAddress ?? "127.0.0.1",
        remoteUser: "test-owner",
      });
      for (const [name, value] of backend.headers) response.setHeader(name, value);
      response.writeHead(backend.statusCode).end(backend.body);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "test backend error");
    }
  });
});

try {
  await store.createBare(storageKey);
  await store.initializeReadme(storageKey, "Git transport test");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const remote = `http://127.0.0.1:${address.port}/fixture.git`;

  await runGit(["clone", remote, cloneDirectory], { env: { GIT_ALLOW_PROTOCOL: "http" } });
  await writeFile(join(cloneDirectory, "hello.txt"), "Pushed through Git smart HTTP.\n");
  await runGit(["config", "user.name", "Nagar Test"], { cwd: cloneDirectory });
  await runGit(["config", "user.email", "test@example.test"], { cwd: cloneDirectory });
  await runGit(["add", "hello.txt"], { cwd: cloneDirectory });
  await runGit(["commit", "-m", "feat: test smart HTTP push"], { cwd: cloneDirectory });
  await runGit(["push", "origin", "main"], {
    cwd: cloneDirectory,
    env: { GIT_ALLOW_PROTOCOL: "http" },
  });

  const branches = await store.branches(storageKey);
  const commits = await store.commits(storageKey, "main");
  const file = await store.textFile(storageKey, "main", "hello.txt");
  assert.deepEqual(branches, ["main"]);
  assert.equal(commits[0]?.message, "feat: test smart HTTP push");
  assert.equal(file, "Pushed through Git smart HTTP.\n");
} finally {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
