export interface ListedRepository {
  owner: string | null;
  namespaceType: "USER" | "ORGANIZATION";
}

/**
 * Splits the dashboard list into what a person owns and what is shared with them (repositories
 * they were invited to, or that belong to an organization they are in).
 */
export function partitionRepositories<T extends ListedRepository>(
  repositories: readonly T[],
  username: string | null | undefined,
): { mine: T[]; shared: T[] } {
  const mine: T[] = [];
  const shared: T[] = [];
  for (const repository of repositories) {
    if (username && repository.namespaceType === "USER" && repository.owner === username)
      mine.push(repository);
    else shared.push(repository);
  }
  return { mine, shared };
}
