import { RepositoryBrowser } from "../../../components/repository-browser";

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; repository: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { username, repository } = await params;
  const { ref } = await searchParams;
  return (
    <RepositoryBrowser
      username={username}
      slug={repository}
      {...(ref ? { initialBranch: ref } : {})}
    />
  );
}
