import { PullRequestBoard } from "../../../../components/pull-request-board";

export default async function PullRequestsPage({
  params,
}: {
  params: Promise<{ username: string; repository: string }>;
}) {
  const { username, repository } = await params;
  return <PullRequestBoard username={username} repository={repository} />;
}
