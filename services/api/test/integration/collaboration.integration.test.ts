import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { integrationSuite, type ApiClient } from "./harness.js";

await integrationSuite("NagarHub collaboration", (harness) => {
  let owner: ApiClient;
  let writer: ApiClient;
  let reader: ApiClient;
  let outsider: ApiClient;
  let anonymous: ApiClient;
  let base = "";
  let vault = "";

  before(async () => {
    await harness.start();
    [owner, writer, reader, outsider] = await Promise.all([
      harness.user("owner"),
      harness.user("writer"),
      harness.user("reader"),
      harness.user("outsider"),
    ]);
    anonymous = harness.anonymous();
    const pub = await owner.post("/api/v1/repositories", { name: "collab", visibility: "PUBLIC" });
    const priv = await owner.post("/api/v1/repositories", { name: "vault", visibility: "PRIVATE" });
    assert.equal(pub.status, 201);
    assert.equal(priv.status, 201);
    base = `/api/v1/repositories/${owner.username}/collab`;
    vault = `/api/v1/repositories/${owner.username}/vault`;
  });
  after(() => harness.stop());

  const notifications = async (client: ApiClient) =>
    (await client.get("/api/v1/notifications")).json.data.notifications as {
      type: string;
      title: string;
      body: string;
      readAt: string | null;
    }[];

  /** Pushes `branch` (cut from main) with one commit and returns when the push has landed. */
  async function pushBranch(
    as: ApiClient,
    slug: string,
    branch: string,
    file: string,
    contents: string,
    message: string,
  ) {
    const clone = await harness.clone(owner.username, slug, as);
    assert.ok(clone.ok, clone.err);
    await harness.git(["checkout", "-b", branch, "origin/main"], { cwd: clone.dir });
    await harness.commit(clone.dir, file, contents, message);
    const pushed = await harness.git(["push", "origin", branch], { cwd: clone.dir });
    assert.ok(pushed.ok, pushed.err);
  }

  describe("repository permissions", () => {
    it("only repository admins can see or change access", async () => {
      assert.equal((await writer.get(`${base}/collaborators`)).status, 403);
      assert.equal(
        (await writer.post(`${base}/collaborators`, { username: writer.username, role: "ADMIN" }))
          .status,
        403,
      );
      assert.equal((await anonymous.get(`${base}/collaborators`)).status, 401);
    });

    it("validates who can be added and with which role", async () => {
      const add = (body: object) => owner.post(`${vault}/collaborators`, body);
      assert.equal((await add({ username: reader.username, role: "READ" })).status, 201);
      assert.equal((await add({ username: reader.username, role: "READ" })).status, 409);
      assert.equal((await add({ username: owner.username, role: "READ" })).status, 409);
      assert.equal((await add({ username: "ghost-user", role: "READ" })).status, 404);
      assert.equal((await add({ username: writer.username, role: "SUPERUSER" })).status, 400);
    });

    it("READ can see and clone but not push; WRITE can push; removal revokes access", async () => {
      assert.equal((await reader.get(vault)).status, 200);
      const clone = await harness.clone(owner.username, "vault", reader);
      assert.ok(clone.ok, clone.err);
      await harness.commit(clone.dir, "x.txt", "x\n", "feat: read-only push");
      assert.equal((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok, false);

      const upgraded = await owner.patch(`${vault}/collaborators/${reader.username}`, {
        role: "WRITE",
      });
      assert.equal(upgraded.json.data.member.role, "WRITE");
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);
      assert.equal((await reader.get(`${vault}/collaborators`)).status, 403, "WRITE is not ADMIN");

      assert.equal((await owner.delete(`${vault}/collaborators/${reader.username}`)).status, 200);
      assert.equal((await reader.get(vault)).status, 404, "removed users lose visibility");
      assert.equal((await harness.clone(owner.username, "vault", reader)).ok, false);
    });

    it("notifies people who are given access", async () => {
      const inbox = await notifications(reader);
      assert.ok(inbox.some((item) => item.type === "REPOSITORY_COLLABORATOR"));
    });
  });

  describe("issues and labels", () => {
    let bug: { id: string };

    it("creates labels (writers only), rejecting bad input and case-insensitive duplicates", async () => {
      const created = await owner.post(`${base}/labels`, {
        name: "bug",
        color: "#d73a4a",
        description: "Something broken",
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.data.label.color, "D73A4A", "normalized to upper-case hex");
      bug = created.json.data.label;

      assert.equal((await owner.post(`${base}/labels`, { name: "BUG" })).status, 409);
      assert.equal((await owner.post(`${base}/labels`, { name: "x", color: "zzz" })).status, 400);
      assert.equal((await owner.post(`${base}/labels`, { name: "bad/name" })).status, 400);
      assert.equal((await owner.post(`${base}/labels`, { name: "" })).status, 400);
      const defaulted = await owner.post(`${base}/labels`, { name: "docs" });
      assert.equal(defaulted.json.data.label.color, "FFD93D");
      assert.equal((await outsider.post(`${base}/labels`, { name: "spam" })).status, 403);
      assert.equal((await anonymous.post(`${base}/labels`, { name: "spam" })).status, 401);
      assert.equal((await anonymous.get(`${base}/labels`)).json.data.labels.length, 2);
    });

    it("lets any signed-in user open an issue on a public repository", async () => {
      assert.equal((await anonymous.post(`${base}/issues`, { title: "anon" })).status, 401);
      const opened = await outsider.post(`${base}/issues`, {
        title: "  Crash on start  ",
        body: "Stack trace…",
        labelIds: [bug.id],
      });
      assert.equal(opened.status, 201);
      assert.equal(opened.json.data.issue.number, 1);
      assert.equal(opened.json.data.issue.title, "Crash on start", "title is trimmed");
      assert.equal(opened.json.data.issue.labels[0].label.name, "bug");

      for (const body of [
        { title: "" },
        { title: "x".repeat(181) },
        { title: "t", body: "x".repeat(20_001) },
        { title: "t", labelIds: ["00000000-0000-4000-8000-000000000000"] },
      ]) {
        assert.equal(
          (await outsider.post(`${base}/issues`, body)).status,
          400,
          JSON.stringify(body).slice(0, 40),
        );
      }
      assert.ok((await notifications(owner)).some((item) => item.type === "ISSUE_OPENED"));
      assert.equal(
        (await notifications(outsider)).some((item) => item.type === "ISSUE_OPENED"),
        false,
        "no notification for your own action",
      );
    });

    it("numbers concurrent issues uniquely and sequentially", async () => {
      const burst = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          reader.post(`${base}/issues`, { title: `burst ${index}` }),
        ),
      );
      const numbers = burst
        .map((response) => response.json.data.issue.number)
        .sort((a, b) => a - b);
      assert.deepEqual(numbers, [2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("lists by state and is readable anonymously", async () => {
      const open = await anonymous.get(`${base}/issues`);
      assert.equal(open.json.data.issues.length, 9);
      assert.equal((await anonymous.get(`${base}/issues?state=CLOSED`)).json.data.issues.length, 0);
    });

    it("lets maintainers edit, close, reopen, and relabel any issue", async () => {
      const closed = await owner.patch(`${base}/issues/1`, {
        state: "CLOSED",
        title: "Crash on startup",
        body: "Updated body",
      });
      assert.equal(closed.status, 200);
      assert.equal(closed.json.data.issue.state, "CLOSED");
      assert.equal(closed.json.data.issue.title, "Crash on startup");
      assert.notEqual(closed.json.data.issue.closedAt, null);
      assert.equal((await anonymous.get(`${base}/issues?state=CLOSED`)).json.data.issues.length, 1);

      const closedNotice = (await notifications(outsider)).find(
        (item) => item.type === "ISSUE_CLOSED",
      );
      assert.ok(closedNotice, "the issue's author hears that it was closed");

      const reopened = await owner.patch(`${base}/issues/1`, { state: "OPEN" });
      assert.equal(reopened.json.data.issue.closedAt, null);
      assert.equal(
        (await owner.patch(`${base}/issues/1`, { labelIds: [] })).json.data.issue.labels.length,
        0,
      );
      assert.equal(
        (await owner.patch(`${base}/issues/1`, { labelIds: [bug.id] })).json.data.issue.labels
          .length,
        1,
      );
      assert.equal((await owner.patch(`${base}/issues/1`, { state: "MAYBE" })).status, 400);
      assert.equal((await owner.patch(`${base}/issues/999`, { state: "CLOSED" })).status, 404);
    });

    it("lets people with only read access manage their own issues, not others'", async () => {
      // `outsider` has no role in the repository but opened issue #1.
      const ownClose = await outsider.patch(`${base}/issues/1`, { state: "CLOSED" });
      assert.equal(ownClose.status, 200, "authors can close their own issue");
      await outsider.patch(`${base}/issues/1`, { state: "OPEN", title: "Crash on startup again" });
      const labels = await outsider.patch(`${base}/issues/1`, { labelIds: [] });
      assert.equal(labels.status, 403, "labels are a maintainer action");
      const foreign = await outsider.patch(`${base}/issues/2`, { state: "CLOSED" });
      assert.equal(foreign.status, 403, "someone else's issue");
      assert.equal((await anonymous.patch(`${base}/issues/1`, { state: "CLOSED" })).status, 401);
    });
  });

  describe("pull requests and reviews", () => {
    before(async () => {
      assert.equal(
        (await owner.post(`${base}/collaborators`, { username: writer.username, role: "WRITE" }))
          .status,
        201,
      );
      assert.equal(
        (await owner.post(`${base}/collaborators`, { username: reader.username, role: "WRITE" }))
          .status,
        201,
      );
      await pushBranch(owner, "collab", "feature/a", "a.txt", "a\n", "feat: a");
      await pushBranch(
        owner,
        "collab",
        "feature/b",
        "README.md",
        "# changed by b\n",
        "feat: b edits readme",
      );
      await pushBranch(
        owner,
        "collab",
        "feature/c",
        "README.md",
        "# changed by c\n",
        "feat: c edits readme",
      );
    });

    const pull = (number: number) => `${base}/pulls/${number}`;

    it("opens a pull request, refusing duplicates, empty comparisons, and unknown branches", async () => {
      const opened = await writer.post(`${base}/pulls`, {
        title: "Add a",
        body: "adds a.txt",
        baseBranch: "main",
        headBranch: "feature/a",
      });
      assert.equal(opened.status, 201);
      assert.equal(opened.json.data.pullRequest.number, 1);
      const open = (body: object) => writer.post(`${base}/pulls`, { title: "t", ...body });
      assert.equal((await open({ baseBranch: "main", headBranch: "feature/a" })).status, 409);
      assert.equal((await open({ baseBranch: "main", headBranch: "main" })).status, 400);
      assert.equal((await open({ baseBranch: "main", headBranch: "ghost" })).status, 400);
      assert.equal(
        (
          await outsider.post(`${base}/pulls`, {
            title: "t",
            baseBranch: "main",
            headBranch: "feature/b",
          })
        ).status,
        403,
        "a person without write access cannot open one",
      );
      assert.ok((await notifications(owner)).some((item) => item.type === "PULL_REQUEST_OPENED"));

      const none = await writer.post(`${base}/pulls`, {
        title: "t",
        baseBranch: "feature/a",
        headBranch: "main",
      });
      assert.equal(none.status, 400);
      assert.equal(none.json.error.code, "NO_CHANGES", "main has nothing feature/a lacks");
    });

    it("shows reviewers what changed: commits, files, and a diff", async () => {
      const detail = await anonymous.get(pull(1));
      assert.equal(detail.status, 200);
      assert.equal(detail.json.data.pullRequest.reviewDecision, "REVIEW_REQUIRED");
      const { comparison } = detail.json.data;
      assert.equal(comparison.ahead, 1);
      assert.deepEqual(
        comparison.files.map((file: { path: string; status: string }) => [file.path, file.status]),
        [["a.txt", "added"]],
      );
      assert.match(comparison.diff, /^\+a$/m);
      assert.equal((await anonymous.get(pull(999))).status, 404);
    });

    it("keeps authors from reviewing themselves and readers from gating the merge", async () => {
      assert.equal((await writer.post(`${pull(1)}/reviews`, { state: "APPROVED" })).status, 403);
      assert.equal((await owner.post(`${pull(1)}/reviews`, { state: "BOGUS" })).status, 400);

      const commentByOutsider = await outsider.post(`${pull(1)}/reviews`, {
        state: "COMMENTED",
        body: "nice",
      });
      assert.equal(commentByOutsider.status, 201, "anyone who can read may comment");
      const approveByOutsider = await outsider.post(`${pull(1)}/reviews`, { state: "APPROVED" });
      assert.equal(approveByOutsider.status, 403, "a verdict needs write access");

      const merge = await writer.patch(pull(1), { state: "MERGED" });
      assert.equal(merge.status, 409);
      assert.equal(merge.json.error.code, "APPROVAL_REQUIRED", "comments alone never approve");
    });

    it("never lets one reviewer's approval hide another reviewer's change request", async () => {
      assert.equal(
        (await owner.post(`${pull(1)}/reviews`, { state: "CHANGES_REQUESTED", body: "rename" }))
          .status,
        201,
      );
      const blocked = await writer.patch(pull(1), { state: "MERGED" });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.json.error.code, "CHANGES_REQUESTED");

      assert.equal((await reader.post(`${pull(1)}/reviews`, { state: "APPROVED" })).status, 201);
      const stillBlocked = await writer.patch(pull(1), { state: "MERGED" });
      assert.equal(
        stillBlocked.status,
        409,
        "a second reviewer's approval does not override the objection",
      );
      assert.equal(stillBlocked.json.error.code, "CHANGES_REQUESTED");

      const summary = (await anonymous.get(pull(1))).json.data.pullRequest;
      assert.equal(summary.reviewDecision, "CHANGES_REQUESTED");
      assert.equal(summary.changesRequestedBy[0].username, owner.username);
      assert.equal(summary.approvedBy[0].username, reader.username);

      await owner.post(`${pull(1)}/reviews`, { state: "APPROVED", body: "thanks, fixed" });
      assert.equal((await anonymous.get(pull(1))).json.data.pullRequest.reviewDecision, "APPROVED");
    });

    it("merges an approved pull request exactly once, even when asked twice at once", async () => {
      const [first, second] = await Promise.all([
        writer.patch(pull(1), { state: "MERGED" }),
        owner.patch(pull(1), { state: "MERGED" }),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], "one merge wins; the other is refused");
      const winner = first.status === 200 ? first : second;
      assert.equal(winner.json.data.pullRequest.state, "MERGED");
      assert.match(winner.json.data.pullRequest.mergeCommitSha, /^[0-9a-f]{40}$/);

      const history = (await anonymous.get(`${base}/commits?perPage=100`)).json.data.commits as {
        message: string;
      }[];
      assert.equal(
        history.filter((commit) => /^Merge .*feature\/a/.test(commit.message)).length,
        1,
      );
      const files = (await anonymous.get(base)).json.data.repository.files as { name: string }[];
      assert.ok(files.some((file) => file.name === "a.txt"));
      assert.equal(
        (await writer.patch(pull(1), { state: "MERGED" })).status,
        409,
        "already merged",
      );

      const merged = (await anonymous.get(pull(1))).json.data;
      assert.equal(merged.pullRequest.state, "MERGED");
      assert.deepEqual(
        merged.comparison.files.map((file: { path: string }) => file.path),
        ["a.txt"],
        "a merged PR still shows what it brought in",
      );
    });

    it("notifies the author when someone else merges or closes their pull request", async () => {
      const open = await writer.post(`${base}/pulls`, {
        title: "B",
        baseBranch: "main",
        headBranch: "feature/b",
      });
      const number = open.json.data.pullRequest.number;
      await owner.post(`${pull(number)}/reviews`, { state: "APPROVED" });
      assert.equal((await owner.patch(pull(number), { state: "MERGED" })).status, 200);
      const titles = (await notifications(writer)).map((item) => item.title);
      assert.ok(titles.includes(`Pull request #${number} merged`), titles.join(" | "));
    });

    it("reports a real merge conflict and leaves the base branch alone", async () => {
      const open = await writer.post(`${base}/pulls`, {
        title: "C",
        baseBranch: "main",
        headBranch: "feature/c",
      });
      const number = open.json.data.pullRequest.number;
      await owner.post(`${pull(number)}/reviews`, { state: "APPROVED" });
      const before = (await anonymous.get(`${base}/commits`)).json.data.commits[0].sha;
      const merge = await owner.patch(pull(number), { state: "MERGED" });
      assert.equal(merge.status, 409);
      assert.equal(merge.json.error.code, "MERGE_CONFLICT");
      assert.equal((await anonymous.get(`${base}/commits`)).json.data.commits[0].sha, before);
      assert.equal((await anonymous.get(pull(number))).json.data.pullRequest.state, "OPEN");

      const closed = await owner.patch(pull(number), { state: "CLOSED" });
      assert.equal(closed.json.data.pullRequest.state, "CLOSED");
      assert.equal(
        (await owner.post(`${pull(number)}/reviews`, { state: "COMMENTED" })).status,
        409,
      );
      assert.equal((await owner.patch(pull(number), { state: "CLOSED" })).status, 409);
    });

    it("refuses to merge a branch that adds nothing new", async () => {
      await pushBranch(owner, "collab", "feature/dup", "dup.txt", "dup\n", "feat: dup");
      const open = await writer.post(`${base}/pulls`, {
        title: "Dup",
        baseBranch: "main",
        headBranch: "feature/dup",
      });
      const number = open.json.data.pullRequest.number;
      await owner.post(`${pull(number)}/reviews`, { state: "APPROVED" });
      // Land the same commits by another route first (a direct push to main).
      const clone = await harness.clone(owner.username, "collab", owner);
      await harness.git(["merge", "--ff-only", "origin/feature/dup"], { cwd: clone.dir });
      assert.ok((await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok);
      const merge = await owner.patch(pull(number), { state: "MERGED" });
      assert.equal(merge.status, 409);
      assert.equal(merge.json.error.code, "NOTHING_TO_MERGE");
    });

    it("requires a session and write access to change a pull request", async () => {
      assert.equal((await anonymous.patch(pull(1), { state: "CLOSED" })).status, 401);
      assert.equal((await outsider.patch(pull(1), { state: "CLOSED" })).status, 403);
      assert.equal((await owner.patch(pull(1), { state: "OPEN" })).status, 400);
    });
  });

  describe("organizations", () => {
    let slug = "";
    let member: ApiClient;

    before(async () => {
      slug = harness.orgSlug("acme");
      member = await harness.user("member");
    });

    it("creates an organization owned by its creator", async () => {
      const created = await owner.post("/api/v1/organizations", {
        name: "Acme Labs",
        slug,
        description: "Team",
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.data.organization.members[0].role, "OWNER");
      assert.equal(
        (await outsider.post("/api/v1/organizations", { name: "Dup", slug })).status,
        409,
      );
      assert.equal(
        (await outsider.post("/api/v1/organizations", { name: "Clash", slug: owner.username }))
          .status,
        409,
        "cannot shadow a username",
      );
      assert.equal(
        (await outsider.get(`/api/v1/organizations/${slug}`)).status,
        404,
        "members only",
      );
    });

    it("manages members and their roles", async () => {
      const members = `/api/v1/organizations/${slug}/members`;
      assert.equal(
        (await owner.post(members, { username: member.username, role: "MEMBER" })).status,
        201,
      );
      assert.equal((await owner.post(members, { username: member.username })).status, 409);
      assert.equal((await member.post(members, { username: outsider.username })).status, 403);
      const mine = (await member.get("/api/v1/organizations")).json.data.organizations;
      assert.equal(
        mine.find((org: { slug: string }) => org.slug === slug).members[0].role,
        "MEMBER",
      );
      assert.ok((await notifications(member)).some((item) => item.type === "ORGANIZATION_MEMBER"));
    });

    it("gives members WRITE on organization repositories and admins ADMIN", async () => {
      const created = await member.post(`/api/v1/organizations/${slug}/repositories`, {
        name: "platform",
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.data.repository.namespace, slug);
      assert.equal(
        (await outsider.post(`/api/v1/organizations/${slug}/repositories`, { name: "sneaky" }))
          .status,
        403,
      );

      const repo = `/api/v1/repositories/${slug}/platform`;
      assert.equal((await anonymous.get(repo)).status, 404, "private by default");
      assert.equal((await outsider.get(repo)).status, 404);

      const clone = await harness.clone(slug, "platform", member);
      assert.ok(clone.ok, clone.err);
      await harness.commit(clone.dir, "svc.txt", "svc\n", "feat: service");
      assert.ok(
        (await harness.git(["push", "origin", "main"], { cwd: clone.dir })).ok,
        "MEMBER has WRITE",
      );
      assert.equal((await member.get(`${repo}/collaborators`)).status, 403, "MEMBER is not ADMIN");
      assert.equal((await owner.get(`${repo}/collaborators`)).status, 200);

      await owner.patch(`/api/v1/organizations/${slug}/members/${member.username}`, {
        role: "ADMIN",
      });
      assert.equal((await member.get(`${repo}/collaborators`)).status, 200, "promoted to ADMIN");
    });

    it("protects owners and removes access when a member leaves", async () => {
      const path = (username: string) => `/api/v1/organizations/${slug}/members/${username}`;
      assert.equal((await member.patch(path(owner.username), { role: "MEMBER" })).status, 409);
      assert.equal((await member.delete(path(owner.username))).status, 409);
      assert.equal((await owner.delete(path(member.username))).status, 200);
      assert.equal((await owner.delete(path(member.username))).status, 404);
      assert.equal((await member.get(`/api/v1/repositories/${slug}/platform`)).status, 404);
    });
  });

  describe("notifications", () => {
    it("lists, marks one read, and marks all read — for the owner of each notification only", async () => {
      const list = (await writer.get("/api/v1/notifications")).json.data;
      assert.ok(list.notifications.length > 0);
      assert.equal(typeof list.unreadCount, "number");
      const unread = list.notifications.find((item: { readAt: string | null }) => !item.readAt);
      assert.ok(unread);

      assert.equal((await outsider.patch(`/api/v1/notifications/${unread.id}/read`)).status, 404);
      assert.equal((await writer.patch(`/api/v1/notifications/${unread.id}/read`)).status, 200);
      assert.equal((await writer.post("/api/v1/notifications/read-all")).status, 200);
      assert.equal((await writer.get("/api/v1/notifications")).json.data.unreadCount, 0);
      assert.equal((await anonymous.get("/api/v1/notifications")).status, 401);
    });
  });
});
