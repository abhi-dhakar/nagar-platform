"use client";

import { getFileIcon } from "@/lib/utils";
import { IconClose } from "./Icons";

export type Tab = {
  id: string;
  path: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
  isUntitled?: boolean;
};

export function EditorTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseAll,
}: {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll?: () => void;
}) {
  if (tabs.length === 0) {
    return (
      <div className="ide-tabs-bar empty">
        <span className="ide-tabs-empty">No open editors</span>
      </div>
    );
  }

  return (
    <div className="ide-tabs-bar" role="tablist" aria-label="Editor tabs">
      <div className="ide-tabs-scroll">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const icon = getFileIcon(tab.path, "file");
          const name = tab.path.split("/").pop() || tab.path;
          return (
            <div
              key={tab.id}
              className={`ide-tab ${isActive ? "active" : ""} ${tab.isDirty ? "dirty" : ""}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              title={tab.path}
            >
              <span className="ide-tab-icon" style={{ color: icon.color }}>
                {icon.icon}
              </span>
              <span className="ide-tab-label">{name}</span>
              <span className="ide-tab-dirty" aria-hidden="true">
                {tab.isDirty ? "●" : ""}
              </span>
              <button
                className="ide-tab-close"
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                title="Close (Ctrl+W)"
              >
                <IconClose width={12} height={12} />
              </button>
              {isActive ? <span className="ide-tab-active-border" /> : null}
            </div>
          );
        })}
      </div>
      {tabs.length > 1 ? (
        <button className="ide-tabs-more" onClick={onCloseAll} title="Close all">
          ⋯
        </button>
      ) : null}
    </div>
  );
}
