import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cleanupDom,
  fail,
  installDom,
  mount,
  ok,
  stubFetch,
  text,
  waitFor,
} from "../test-utils/dom";
import { CommitHistory } from "./commit-history";

const commit = (index: number) => ({
  sha: String(index).padStart(40, "0"),
  shortSha: String(index).padStart(7, "0"),
  author: "Ada",
  email: "ada@example.test",
  date: "2026-09-30T10:00:00+00:00",
  message: `feat: change ${index}`,
});
const branches = {
  defaultBranch: "main",
  branches: [
    { name: "main", isDefault: true },
    { name: "dev", isDefault: false },
  ],
};

describe("CommitHistory", () => {
  before(installDom);
  after(cleanupDom);

  it("shows the newest page with totals and a link to older commits", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/branches")
        ? ok(branches)
        : call.url.includes("/commits?")
          ? ok({
              ref: "main",
              page: 1,
              perPage: 30,
              total: 36,
              hasMore: true,
              commits: [commit(36), commit(35)],
            })
          : undefined,
    );
    const container = await mount(<CommitHistory username="ada" repository="engine" page={1} />);
    await waitFor(() => container.querySelectorAll("article").length === 2);

    assert.ok(calls.some((call) => call.url === "/api/v1/repositories/ada/engine/commits?page=1"));
    assert.match(text(container.querySelector("h2")), /36 commits on\s*main/);
    assert.match(text(container.querySelector("article")), /feat: change 36/);
    const older = [...container.querySelectorAll("a")].find((a) => /Older/.test(text(a)));
    assert.equal(older?.getAttribute("href"), "/ada/engine/commits?branch=main&page=2");
    assert.equal(
      [...container.querySelectorAll("a")].some((a) => /Newer/.test(text(a))),
      false,
    );
  });

  it("requests a specific branch and page, and links back to newer commits", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/branches")
        ? ok(branches)
        : ok({
            ref: "feature/x",
            page: 2,
            perPage: 30,
            total: 36,
            hasMore: false,
            commits: [commit(6)],
          }),
    );
    const container = await mount(
      <CommitHistory username="ada" repository="engine" branch="feature/x" page={2} />,
    );
    await waitFor(() => container.querySelectorAll("article").length === 1);
    assert.ok(calls.some((call) => call.url.endsWith("/commits?page=2&ref=feature%2Fx")));
    const newer = [...container.querySelectorAll("a")].find((a) => /Newer/.test(text(a)));
    assert.equal(newer?.getAttribute("href"), "/ada/engine/commits?branch=feature%2Fx");
    assert.equal(
      [...container.querySelectorAll("a")].some((a) => /Older/.test(text(a))),
      false,
    );
    assert.match(text(container), /Page 2/);
  });

  it("offers a branch picker that submits as a plain GET form", async () => {
    stubFetch((call) =>
      call.url.endsWith("/branches")
        ? ok(branches)
        : ok({ ref: "main", page: 1, perPage: 30, total: 1, hasMore: false, commits: [commit(1)] }),
    );
    const container = await mount(<CommitHistory username="ada" repository="engine" page={1} />);
    const select = await waitFor(() => container.querySelector("select"));
    assert.deepEqual(
      [...select.options].map((option) => option.textContent),
      ["main (default)", "dev"],
    );
    assert.equal(select.value, "main");
    const form = select.closest("form");
    assert.equal(form?.getAttribute("method"), "get");
    assert.equal(form?.getAttribute("action"), "/ada/engine/commits");
    assert.equal(select.getAttribute("name"), "branch");
  });

  it("explains an empty history and surfaces errors", async () => {
    stubFetch((call) =>
      call.url.endsWith("/branches")
        ? ok({ defaultBranch: "main", branches: [] })
        : ok({ ref: null, page: 1, perPage: 30, total: 0, hasMore: false, commits: [] }),
    );
    const empty = await mount(<CommitHistory username="ada" repository="new" page={1} />);
    await waitFor(() => /No commits yet/.test(text(empty)));

    stubFetch((call) =>
      call.url.endsWith("/branches")
        ? ok(branches)
        : fail(404, "BRANCH_NOT_FOUND", "Branch was not found."),
    );
    const broken = await mount(
      <CommitHistory username="ada" repository="engine" branch="ghost" page={1} />,
    );
    const alert = await waitFor(() => broken.querySelector('[role="alert"]'));
    assert.equal(text(alert), "Branch was not found.");
  });
});
