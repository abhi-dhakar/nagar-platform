import { OrganizationProfile } from "../../../components/organization-profile";

export default async function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <OrganizationProfile slug={slug} />;
}
