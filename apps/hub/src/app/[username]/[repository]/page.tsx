import { RepositoryBrowser } from "../../../components/repository-browser";

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ username: string; repository: string }>;
}) {
  const { username, repository } = await params;
  return <RepositoryBrowser username={username} slug={repository} />;
}
