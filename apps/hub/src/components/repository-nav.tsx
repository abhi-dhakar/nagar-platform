import Link from "next/link";

export type RepositoryTab = "code" | "commits" | "branches" | "issues" | "pulls" | "settings";

/** The tab row shared by every repository screen, so each area is one click from the others. */
export function RepositoryNav({
  username,
  repository,
  active,
  counts = {},
  inline = false,
}: {
  username: string;
  repository: string;
  active: RepositoryTab;
  counts?: Partial<Record<RepositoryTab, number>>;
  inline?: boolean;
}) {
  const base = `/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const tabs: { id: RepositoryTab; label: string; href: string }[] = [
    { id: "code", label: "Code", href: base },
    { id: "commits", label: "Commits", href: `${base}/commits` },
    { id: "branches", label: "Branches", href: `${base}/branches` },
    { id: "issues", label: "Issues", href: `${base}/issues` },
    { id: "pulls", label: "Pull requests", href: `${base}/pulls` },
    { id: "settings", label: "Access & webhooks", href: `${base}/settings` },
  ];
  return (
    <nav
      className={`collab-tabs${inline ? " repo-nav-inline" : ""}`}
      aria-label="Repository sections"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={tab.id === active ? "active" : undefined}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
          {counts[tab.id] !== undefined && <span>{counts[tab.id]}</span>}
        </Link>
      ))}
    </nav>
  );
}
