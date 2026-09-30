import { IssueBoard } from "../../../../components/issue-board";

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ username: string; repository: string }>;
}) {
  const { username, repository } = await params;
  return <IssueBoard username={username} repository={repository} />;
}
