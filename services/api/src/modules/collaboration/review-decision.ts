export type ReviewState = "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED";
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

export interface ReviewSummary {
  decision: ReviewDecision;
  /** Reviewers whose most recent verdict is an approval. */
  approvedBy: string[];
  /** Reviewers whose most recent verdict is a request for changes. */
  changesRequestedBy: string[];
}

/**
 * Collapses a pull request's review history into one merge decision.
 *
 * Each reviewer has a single standing verdict: their most recent APPROVED or CHANGES_REQUESTED
 * review. A later COMMENTED review does not withdraw it, and a later approval replaces the same
 * reviewer's earlier change request. The pull request is approved only when at least one
 * reviewer approves and nobody is still requesting changes, so one person's approval can never
 * hide another person's objection. The author's own reviews never count, and when
 * `eligibleReviewerIds` is given only those reviewers (people who currently have write access)
 * count: anyone may comment, but only maintainers can approve or block a merge.
 */
export function summarizeReviews(
  reviews: readonly { reviewerId: string; state: ReviewState; createdAt: Date | string }[],
  authorId: string,
  eligibleReviewerIds?: ReadonlySet<string>,
): ReviewSummary {
  const ordered = [...reviews].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const standing = new Map<string, "APPROVED" | "CHANGES_REQUESTED">();
  for (const review of ordered) {
    if (review.reviewerId === authorId || review.state === "COMMENTED") continue;
    if (eligibleReviewerIds && !eligibleReviewerIds.has(review.reviewerId)) continue;
    standing.set(review.reviewerId, review.state);
  }
  const approvedBy = [...standing].filter(([, state]) => state === "APPROVED").map(([id]) => id);
  const changesRequestedBy = [...standing]
    .filter(([, state]) => state === "CHANGES_REQUESTED")
    .map(([id]) => id);
  const decision: ReviewDecision = changesRequestedBy.length
    ? "CHANGES_REQUESTED"
    : approvedBy.length
      ? "APPROVED"
      : "REVIEW_REQUIRED";
  return { decision, approvedBy, changesRequestedBy };
}
