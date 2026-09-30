import { RepositorySettings } from "../../../../components/repository-settings";

export default async function RepositorySettingsPage({
  params,
}: {
  params: Promise<{ username: string; repository: string }>;
}) {
  const { username, repository } = await params;
  return <RepositorySettings username={username} repository={repository} />;
}
