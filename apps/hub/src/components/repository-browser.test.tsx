import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupDom,
  click,
  installDom,
  mount,
  ok,
  stubFetch,
  text,
  waitFor,
} from "../test-utils/dom";
import { RepositoryBrowser } from "./repository-browser";

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "engine",
  slug: "engine",
  description: "An engine",
  visibility: "PUBLIC",
  updatedAt: "2026-09-30T10:00:00Z",
  owner: { id: "u1", name: "Ada", username: "ada" },
  cloneUrl: "http://localhost:4000/git/ada/engine.git",
  namespaceType: "USER",
  defaultBranch: "main",
  branch: "main",
  branches: ["main", "feature/x"],
  files: [
    { name: "README.md", path: "README.md", kind: "file", sha: "a".repeat(40) },
    { name: "logo.bin", path: "logo.bin", kind: "file", sha: "b".repeat(40) },
    { name: "big.txt", path: "big.txt", kind: "file", sha: "c".repeat(40) },
  ],
  commits: [
    {
      sha: "d".repeat(40),
      shortSha: "ddddddd",
      author: "Ada",
      email: "a@x.test",
      date: "2026-09-30T10:00:00Z",
      message: "feat: engine",
    },
  ],
  readme: "# Engine\n\nHello <script>window.pwned=1</script> [bad](javascript:alert(1))",
  ...overrides,
});

describe("RepositoryBrowser", () => {
  before(installDom);
  after(cleanupDom);

  it("renders the README safely and offers history and branch navigation", async () => {
    stubFetch((call) =>
      call.url.startsWith("/api/v1/repositories/ada/engine?") ||
      call.url === "/api/v1/repositories/ada/engine"
        ? ok({ repository: summary() })
        : undefined,
    );
    const container = await mount(<RepositoryBrowser username="ada" slug="engine" />);
    const article = await waitFor(() => container.querySelector(".markdown-body"));
    assert.equal(article.querySelector("h1")?.textContent, "Engine");
    assert.equal(container.querySelector("script"), null, "README HTML is never executed");
    assert.match(text(article), /<script>window\.pwned=1<\/script>/);
    assert.equal(
      [...article.querySelectorAll("a")].some((a) =>
        /^javascript:/i.test(a.getAttribute("href") ?? ""),
      ),
      false,
    );

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    assert.ok(hrefs.includes("/ada/engine/commits"), "commits tab");
    assert.ok(hrefs.includes("/ada/engine/branches"), "branches tab");
    assert.ok(hrefs.includes("/ada/engine/commits?branch=main"), "full history link");
    assert.match(text(container.querySelector(".clone-control")), /git\/ada\/engine\.git/);
    assert.match(text(container), /2 branches/);
  });

  it("opens the branch the link asked for", async () => {
    const calls = stubFetch((call) =>
      call.url.includes("/api/v1/repositories/ada/engine")
        ? ok({ repository: summary({ branch: "feature/x" }) })
        : undefined,
    );
    const container = await mount(
      <RepositoryBrowser username="ada" slug="engine" initialBranch="feature/x" />,
    );
    await waitFor(() => container.querySelector(".markdown-body"));
    assert.equal(calls[0]?.url, "/api/v1/repositories/ada/engine?ref=feature%2Fx");
    assert.equal(
      container.querySelector<HTMLSelectElement>(".branch-select select")?.value,
      "feature/x",
    );
  });

  it("says so, instead of showing garbage, for binary and oversized files", async () => {
    stubFetch(
      (call) =>
        call.url.includes("/blob?") && call.url.includes("logo.bin")
          ? ok({ branch: "main", path: "logo.bin", size: 2048, binary: true, content: null })
          : undefined,
      (call) =>
        call.url.includes("/blob?") && call.url.includes("big.txt")
          ? ok({
              branch: "main",
              path: "big.txt",
              size: 3 * 1024 * 1024,
              tooLarge: true,
              content: null,
            })
          : undefined,
      (call) =>
        call.url.includes("/blob?") && call.url.includes("README.md")
          ? ok({ branch: "main", path: "README.md", size: 5, content: "hello" })
          : undefined,
      () => ok({ repository: summary() }),
    );
    const container = await mount(<RepositoryBrowser username="ada" slug="engine" />);
    await waitFor(() => container.querySelector(".file-row"));
    const open = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>(".file-row")].find(
        (row) => text(row.querySelector(".file-name")) === name,
      )!;

    await click(open("logo.bin"));
    await waitFor(() =>
      /Binary file \(2\.0 KB\)/.test(text(container.querySelector(".file-preview"))),
    );
    await click(open("big.txt"));
    await waitFor(() =>
      /3\.0 MB, which is too large to preview/.test(text(container.querySelector(".file-preview"))),
    );
    await click(open("README.md"));
    await waitFor(() => container.querySelector(".source-preview code")?.textContent === "hello");
  });
});
