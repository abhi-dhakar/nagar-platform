import { dispatchRepositoryEvent } from "../collaboration/events.js";
import { diffRefs, type GitStore } from "./git-store.js";

const EMPTY_SHA = "0".repeat(40);
const MAX_REFS_PER_PUSH = 20;

export interface PushContext {
  repositoryId: string;
  storageKey: string;
  repository: { name: string; owner: string };
  pusher: { id: string | null; username: string | null };
}

/**
 * Publishes one `push` webhook event per branch or tag that a push created, moved, or deleted.
 * Returns how many refs changed so callers can tell a real push from a no-op request.
 */
export async function publishPushEvents(
  store: GitStore,
  context: PushContext,
  before: Map<string, string>,
  after: Map<string, string>,
): Promise<number> {
  const updates = diffRefs(before, after);
  for (const update of updates.slice(0, MAX_REFS_PER_PUSH)) {
    const commits = update.after
      ? await store.newCommits(
          context.storageKey,
          update.after,
          // A new ref only "adds" what no existing ref already had.
          update.before ? [update.before] : [...before.values()],
        )
      : [];
    dispatchRepositoryEvent(context.repositoryId, "push", {
      ref: update.ref,
      before: update.before ?? EMPTY_SHA,
      after: update.after ?? EMPTY_SHA,
      created: update.before === null,
      deleted: update.after === null,
      commits: commits.map((commit) => ({
        id: commit.sha,
        message: commit.message,
        author: { name: commit.author, email: commit.email },
        timestamp: commit.date,
      })),
      pusher: context.pusher,
      repository: context.repository,
    });
  }
  return updates.length;
}
