import { PullRequestBoard } from "../../../../components/pull-request-board";

export default async function PullRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; repository: string }>;
  searchParams: Promise<{ head?: string }>;
}) {
  const { username, repository } = await params;
  const { head } = await searchParams;
  return (
    <PullRequestBoard
      username={username}
      repository={repository}
      {...(head ? { initialHead: head } : {})}
    />
  );
}
