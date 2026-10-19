"use client";

import { IconExplorer, IconGit, IconHub, IconSearch, IconSettings } from "./Icons";

export type ActivityId = "explorer" | "search" | "scm" | "nagarhub" | "settings";

const items: {
  id: ActivityId;
  label: string;
  shortcut?: string;
  Icon: React.ComponentType<{ width?: number; height?: number; className?: string }>;
}[] = [
  { id: "explorer", label: "Explorer", shortcut: "Ctrl+Shift+E", Icon: IconExplorer },
  { id: "search", label: "Search", shortcut: "Ctrl+Shift+F", Icon: IconSearch },
  { id: "scm", label: "Source Control", Icon: IconGit },
  { id: "nagarhub", label: "NagarHub", Icon: IconHub },
  { id: "settings", label: "Settings", shortcut: "Ctrl+,", Icon: IconSettings },
];

export function ActivityBar({
  active,
  onSelect,
}: {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
}) {
  return (
    <div className="ide-activitybar" role="toolbar" aria-label="Activity bar">
      <div className="ide-activity-top">
        <div className="ide-activity-brand" title="NagarCode — Nagar Platform">
          <span className="ide-brand-mark">N</span>
        </div>
        <div className="ide-activity-items">
          {items.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`ide-activity-btn ${active === id ? "active" : ""}`}
              aria-label={label}
              aria-pressed={active === id}
              title={`${label}${items.find((i) => i.id === id)?.shortcut ? ` (${items.find((i) => i.id === id)?.shortcut})` : ""}`}
              onClick={() => onSelect(id)}
            >
              <Icon width={20} height={20} />
              <span className="ide-activity-indicator" aria-hidden="true" />
              <span className="ide-tooltip" role="tooltip">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="ide-activity-bottom">
        <div
          className="ide-activity-account"
          title="Nagar account — single identity across Hub, Code & Deploy"
        >
          <span className="ide-account-avatar">A</span>
        </div>
      </div>
    </div>
  );
}
