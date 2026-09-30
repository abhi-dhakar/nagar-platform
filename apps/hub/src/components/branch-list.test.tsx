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
import { BranchList } from "./branch-list";

const branch = (name: string, isDefault = false) => ({
  name,
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  author: "Ada",
  date: "2026-09-30T10:00:00+00:00",
  message: `work on ${name}`,
  isDefault,
});

describe("BranchList", () => {
  before(installDom);
  after(cleanupDom);

  it("lists branches with the default marked and per-branch actions", async () => {
    const calls = stubFetch((call) =>
      call.url === "/api/v1/repositories/ada/engine/branches"
        ? ok({ defaultBranch: "main", branches: [branch("main", true), branch("feature/x")] })
        : undefined,
    );
    const container = await mount(<BranchList username="ada" repository="engine" />);
    await waitFor(() => container.querySelectorAll("article").length === 2);

    assert.equal(calls[0]?.url, "/api/v1/repositories/ada/engine/branches");
    const rows = [...container.querySelectorAll("article")];
    assert.equal(rows.filter((row) => /DEFAULT/.test(text(row))).length, 1);
    assert.match(text(rows[0]), /^main\s*DEFAULT/);
    assert.match(text(rows[1]), /work on feature\/x/);

    const hrefs = (row: Element) =>
      [...row.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    assert.ok(hrefs(rows[1]!).includes("/ada/engine?ref=feature%2Fx"), "browse");
    assert.ok(hrefs(rows[1]!).includes("/ada/engine/commits?branch=feature%2Fx"), "history");
    assert.ok(hrefs(rows[1]!).includes("/ada/engine/pulls?head=feature%2Fx"), "open pull request");
    assert.equal(
      hrefs(rows[0]!).some((href) => href?.includes("/pulls")),
      false,
      "the default branch has nothing to propose merging",
    );
    assert.match(
      text(container.querySelector('nav[aria-label="Repository sections"]')),
      /Branches/,
    );
  });

  it("explains an empty repository", async () => {
    stubFetch(() => ok({ defaultBranch: "main", branches: [] }));
    const container = await mount(<BranchList username="ada" repository="empty" />);
    await waitFor(() => /No branches yet/.test(text(container)));
  });

  it("shows the server's message when the repository can't be loaded", async () => {
    stubFetch(() => fail(404, "REPOSITORY_NOT_FOUND", "Repository was not found."));
    const container = await mount(<BranchList username="ada" repository="ghost" />);
    const alert = await waitFor(() => container.querySelector('[role="alert"]'));
    assert.equal(text(alert), "Repository was not found.");
  });
});
