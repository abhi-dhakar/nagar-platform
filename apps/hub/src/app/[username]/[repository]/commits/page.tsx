import { CommitHistory } from "../../../../components/commit-history";

export default async function CommitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; repository: string }>;
  searchParams: Promise<{ branch?: string; page?: string }>;
}) {
  const { username, repository } = await params;
  const { branch, page } = await searchParams;
  const pageNumber = Number(page);
  return (
    <CommitHistory
      username={username}
      repository={repository}
      {...(branch ? { branch } : {})}
      page={Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1}
    />
  );
}
