import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  buttonLabelled,
  cleanupDom,
  click,
  installDom,
  mount,
  ok,
  stubFetch,
  text,
  waitFor,
} from "../test-utils/dom";
import { PullRequestBoard } from "./pull-request-board";

const person = (username: string) => ({ id: `id-${username}`, name: username, username });
const pull = (overrides: Record<string, unknown> = {}) => ({
  id: "pr-1",
  number: 1,
  title: "Add login",
  body: "Adds the login page",
  state: "OPEN",
  baseBranch: "main",
  headBranch: "feature/login",
  mergeCommitSha: null,
  createdAt: "2026-09-30T10:00:00Z",
  author: person("ada"),
  reviews: [],
  reviewDecision: "REVIEW_REQUIRED",
  approvedBy: [],
  changesRequestedBy: [],
  ...overrides,
});
const list = (pulls: unknown[]) =>
  ok({ pullRequests: pulls, branches: ["main", "feature/login", "feature/x"] });
const comparison = (diff: string) => ({
  ahead: 1,
  behind: 0,
  commits: [{ sha: "a".repeat(40), shortSha: "aaaaaaa", author: "Ada", message: "feat: login" }],
  commitsTruncated: false,
  files: [
    { path: "login.txt", status: "added", additions: 2, deletions: 0, binary: false },
    { path: "logo.bin", status: "added", additions: 0, deletions: 0, binary: true },
  ],
  filesTruncated: false,
  totals: { files: 2, additions: 2, deletions: 0 },
  diff,
  diffTruncated: false,
});

describe("PullRequestBoard", () => {
  before(installDom);
  after(cleanupDom);

  it("blocks merging while a reviewer is still asking for changes, and says who", async () => {
    stubFetch((call) =>
      call.url.endsWith("/pulls")
        ? list([
            pull({
              reviewDecision: "CHANGES_REQUESTED",
              approvedBy: [person("grace")],
              changesRequestedBy: [person("linus")],
            }),
          ])
        : undefined,
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));

    const merge = buttonLabelled(container, /Merge approved PR/)!;
    assert.equal(merge.disabled, true);
    assert.match(merge.title, /requested changes/i);
    const row = text(container.querySelector("article"));
    assert.match(row, /Changes requested/);
    assert.match(row, /Changes requested by @linus/);
    assert.match(row, /Approved by @grace/);
  });

  it("asks for an approval before anything else", async () => {
    stubFetch(() => list([pull()]));
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    const merge = buttonLabelled(container, /Merge approved PR/)!;
    assert.equal(merge.disabled, true);
    assert.match(merge.title, /approval from a collaborator with write access/i);
    assert.match(text(container.querySelector("article")), /Review required/);
  });

  it("merges an approved pull request and reports the merge commit", async () => {
    let merged = false;
    const calls = stubFetch(
      (call) =>
        call.method === "PATCH" && call.url.endsWith("/pulls/1")
          ? ((merged = true),
            ok({
              pullRequest: pull({ state: "MERGED", mergeCommitSha: "abc1234".padEnd(40, "0") }),
            }))
          : undefined,
      (call) =>
        call.url.endsWith("/pulls")
          ? list([
              merged
                ? pull({ state: "MERGED" })
                : pull({ reviewDecision: "APPROVED", approvedBy: [person("grace")] }),
            ])
          : undefined,
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    const merge = buttonLabelled(container, /Merge approved PR/)!;
    assert.equal(merge.disabled, false);
    assert.match(merge.title, /Merge this pull request/);

    await click(merge);
    await waitFor(() => /Merged as abc1234/.test(text(container)));
    const patch = calls.find((call) => call.method === "PATCH");
    assert.deepEqual(patch?.body, { state: "MERGED" });
  });

  it("surfaces the server's reason when a merge is refused", async () => {
    stubFetch(
      (call) =>
        call.method === "PATCH"
          ? {
              status: 409,
              body: {
                success: false,
                error: {
                  code: "MERGE_CONFLICT",
                  message: "The branches could not be merged cleanly.",
                },
              },
            }
          : undefined,
      () => list([pull({ reviewDecision: "APPROVED" })]),
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, /Merge approved PR/)!);
    const alert = await waitFor(() => container.querySelector('[role="alert"]'));
    assert.match(text(alert), /could not be merged cleanly/);
  });

  it("shows what changed: summary, commits, files, and a highlighted diff", async () => {
    const calls = stubFetch(
      (call) =>
        call.url.endsWith("/pulls/1")
          ? ok({
              pullRequest: pull(),
              comparison: comparison(
                "diff --git a/login.txt b/login.txt\n@@ -0,0 +1,2 @@\n+line one\n+line two\n",
              ),
            })
          : undefined,
      () => list([pull()]),
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    assert.equal(container.querySelector(".changes-panel"), null, "collapsed by default");

    await click(buttonLabelled(container, "Show changes")!);
    const panel = await waitFor(() => container.querySelector(".changes-panel .diff-view"));
    assert.ok(calls.some((call) => call.url.endsWith("/pulls/1")));
    const summary = text(container.querySelector(".changes-summary"));
    assert.match(summary, /2\s*files changed/);
    assert.match(summary, /\+2/);
    assert.equal(container.querySelectorAll(".changes-files li").length, 2);
    assert.match(text(container.querySelector(".changes-files")), /logo\.bin\s*binary/);
    assert.equal(panel.querySelectorAll(".diff-line.add").length, 2);
    assert.equal(panel.querySelectorAll(".diff-line.hunk").length, 1);
    assert.equal(buttonLabelled(container, "Hide changes") !== undefined, true);

    await click(buttonLabelled(container, "Hide changes")!);
    assert.equal(container.querySelector(".changes-panel"), null);
  });

  it("never turns diff content into markup", async () => {
    stubFetch(
      (call) =>
        call.url.endsWith("/pulls/1")
          ? ok({
              pullRequest: pull(),
              comparison: comparison(
                '+<img src=x onerror="window.pwned=1">\n+<script>window.pwned=2</script>',
              ),
            })
          : undefined,
      () => list([pull()]),
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, "Show changes")!);
    const view = await waitFor(() => container.querySelector(".diff-view"));
    assert.equal(view.querySelector("img, script"), null);
    assert.match(text(view), /<img src=x onerror=/);
  });

  it("explains when a closed pull request's branches are gone", async () => {
    stubFetch(
      (call) =>
        call.url.endsWith("/pulls/1") ? ok({ pullRequest: pull(), comparison: null }) : undefined,
      () => list([pull()]),
    );
    const container = await mount(<PullRequestBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, "Show changes")!);
    await waitFor(() => /no longer exist/.test(text(container)));
  });

  it("pre-selects the compare branch from a link on the branches page", async () => {
    stubFetch(() => list([]));
    const container = await mount(
      <PullRequestBoard username="ada" repository="engine" initialHead="feature/x" />,
    );
    const selects = await waitFor(() => {
      const found = container.querySelectorAll("aside select");
      return found.length === 2 ? [...found] : null;
    });
    assert.equal((selects[0] as HTMLSelectElement).value, "main");
    assert.equal((selects[1] as HTMLSelectElement).value, "feature/x");
  });
});
