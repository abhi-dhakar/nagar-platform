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
  submit,
  text,
  type,
  waitFor,
} from "../test-utils/dom";
import { IssueBoard } from "./issue-board";

const bug = { id: "label-bug", name: "bug", color: "D73A4A", description: null };
const docs = { id: "label-docs", name: "docs", color: "0075CA", description: null };
const issue = {
  id: "issue-1",
  number: 1,
  title: "Crash on start",
  body: "Stack trace",
  state: "OPEN",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
  author: { id: "u1", name: "Ada", username: "ada" },
  labels: [{ label: bug }],
};
const routes = () => [
  (call: { url: string; method: string }) =>
    call.method === "GET" && call.url.includes("/issues?") ? ok({ issues: [issue] }) : undefined,
  (call: { url: string; method: string }) =>
    call.method === "GET" && call.url.endsWith("/labels") ? ok({ labels: [bug, docs] }) : undefined,
];

describe("IssueBoard editing", () => {
  before(installDom);
  after(cleanupDom);

  it("edits an issue's title and description without touching labels it did not change", async () => {
    const calls = stubFetch(
      (call) => (call.method === "PATCH" ? ok({ issue }) : undefined),
      ...routes(),
    );
    const container = await mount(<IssueBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));

    await click(buttonLabelled(container, "Edit")!);
    const form = await waitFor(() => container.querySelector<HTMLFormElement>(".issue-edit-form"));
    const [title, body] = [
      form.querySelector<HTMLInputElement>("input:not([type=checkbox])")!,
      form.querySelector<HTMLTextAreaElement>("textarea")!,
    ];
    assert.equal(title.value, "Crash on start", "the form starts from the current values");
    assert.equal(body.value, "Stack trace");
    assert.equal(form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked, true);

    await type(title, "Crash on startup");
    await type(body, "Stack trace and steps");
    await submit(form);
    await waitFor(() => /Issue #1 updated/.test(text(container)));

    const patch = calls.find((call) => call.method === "PATCH");
    assert.match(patch?.url ?? "", /\/issues\/1$/);
    assert.deepEqual(patch?.body, { title: "Crash on startup", body: "Stack trace and steps" });
    assert.equal(
      container.querySelector(".issue-edit-form"),
      null,
      "the editor closes after saving",
    );
  });

  it("sends the new label set only when labels were changed", async () => {
    const calls = stubFetch(
      (call) => (call.method === "PATCH" ? ok({ issue }) : undefined),
      ...routes(),
    );
    const container = await mount(<IssueBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, "Edit")!);
    const form = await waitFor(() => container.querySelector<HTMLFormElement>(".issue-edit-form"));
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await click(boxes[1]!); // add "docs"
    await submit(form);
    await waitFor(() => calls.some((call) => call.method === "PATCH"));
    const patch = calls.find((call) => call.method === "PATCH");
    assert.deepEqual((patch?.body as { labelIds: string[] }).labelIds.sort(), [
      "label-bug",
      "label-docs",
    ]);
  });

  it("shows the server's message, e.g. when labels need write access", async () => {
    stubFetch(
      (call) =>
        call.method === "PATCH"
          ? {
              status: 403,
              body: {
                success: false,
                error: { code: "FORBIDDEN", message: "Write access is required to change labels." },
              },
            }
          : undefined,
      ...routes(),
    );
    const container = await mount(<IssueBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, "Edit")!);
    const form = await waitFor(() => container.querySelector<HTMLFormElement>(".issue-edit-form"));
    await click(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!);
    await submit(form);
    const alert = await waitFor(() => container.querySelector('[role="alert"]'));
    assert.match(text(alert), /Write access is required to change labels/);
    assert.ok(
      container.querySelector(".issue-edit-form"),
      "the editor stays open so nothing is lost",
    );
  });

  it("can cancel an edit", async () => {
    stubFetch(...routes());
    const container = await mount(<IssueBoard username="ada" repository="engine" />);
    await waitFor(() => container.querySelector("article"));
    await click(buttonLabelled(container, "Edit")!);
    await waitFor(() => container.querySelector(".issue-edit-form"));
    await click(buttonLabelled(container, "Cancel")!);
    assert.equal(container.querySelector(".issue-edit-form"), null);
    assert.match(text(container.querySelector("article")), /#1 · Crash on start/);
  });
});
