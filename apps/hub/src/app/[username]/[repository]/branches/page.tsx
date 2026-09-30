import { BranchList } from "../../../../components/branch-list";

export default async function BranchesPage({
  params,
}: {
  params: Promise<{ username: string; repository: string }>;
}) {
  const { username, repository } = await params;
  return <BranchList username={username} repository={repository} />;
}
