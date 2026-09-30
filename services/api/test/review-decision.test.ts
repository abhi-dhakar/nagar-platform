import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeReviews,
  type ReviewState,
} from "../src/modules/collaboration/review-decision.js";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const review = (reviewerId: string, state: ReviewState, minute: number) => ({
  reviewerId,
  state,
  createdAt: at(minute),
});

test("a pull request without reviews needs a review", () => {
  assert.equal(summarizeReviews([], "author").decision, "REVIEW_REQUIRED");
});

test("one approval approves", () => {
  const summary = summarizeReviews([review("a", "APPROVED", 1)], "author");
  assert.equal(summary.decision, "APPROVED");
  assert.deepEqual(summary.approvedBy, ["a"]);
});

test("a later approval from someone else cannot hide an outstanding change request", () => {
  const summary = summarizeReviews(
    [review("a", "CHANGES_REQUESTED", 1), review("b", "APPROVED", 2)],
    "author",
  );
  assert.equal(summary.decision, "CHANGES_REQUESTED");
  assert.deepEqual(summary.changesRequestedBy, ["a"]);
  assert.deepEqual(summary.approvedBy, ["b"]);
});

test("the same reviewer can withdraw their change request by approving later", () => {
  const summary = summarizeReviews(
    [review("a", "CHANGES_REQUESTED", 1), review("a", "APPROVED", 2)],
    "author",
  );
  assert.equal(summary.decision, "APPROVED");
  assert.deepEqual(summary.changesRequestedBy, []);
});

test("a later plain comment does not withdraw an approval or a change request", () => {
  assert.equal(
    summarizeReviews([review("a", "APPROVED", 1), review("a", "COMMENTED", 2)], "x").decision,
    "APPROVED",
  );
  assert.equal(
    summarizeReviews([review("a", "CHANGES_REQUESTED", 1), review("a", "COMMENTED", 2)], "x")
      .decision,
    "CHANGES_REQUESTED",
  );
});

test("comments alone never approve", () => {
  assert.equal(summarizeReviews([review("a", "COMMENTED", 1)], "x").decision, "REVIEW_REQUIRED");
});

test("the author's own reviews are ignored", () => {
  assert.equal(
    summarizeReviews([review("author", "APPROVED", 1)], "author").decision,
    "REVIEW_REQUIRED",
  );
});

test("only eligible reviewers (people with write access) count when a set is given", () => {
  const reviews = [review("reader", "APPROVED", 1), review("maintainer", "COMMENTED", 2)];
  assert.equal(
    summarizeReviews(reviews, "author", new Set(["maintainer"])).decision,
    "REVIEW_REQUIRED",
  );
  assert.equal(summarizeReviews(reviews, "author", new Set(["reader"])).decision, "APPROVED");
  // A reader's request for changes cannot block a merge either.
  assert.equal(
    summarizeReviews(
      [review("reader", "CHANGES_REQUESTED", 1), review("maintainer", "APPROVED", 2)],
      "author",
      new Set(["maintainer"]),
    ).decision,
    "APPROVED",
  );
});

test("history is ordered by time, not by the order it was passed in", () => {
  const summary = summarizeReviews(
    [review("a", "APPROVED", 5), review("a", "CHANGES_REQUESTED", 1)],
    "author",
  );
  assert.equal(summary.decision, "APPROVED");
});
