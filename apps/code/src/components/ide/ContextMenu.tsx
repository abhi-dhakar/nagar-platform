"use client";

import { useEffect, useRef } from "react";

export type ContextMenuActionItem = {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
};

export type ContextMenuItem = ContextMenuActionItem | { id: "separator" };

export function isSeparator(item: ContextMenuItem): item is { id: "separator" } {
  return item.id === "separator";
}

export function ContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.min(x, typeof window !== "undefined" ? window.innerWidth - 220 : x),
    top: Math.min(y, typeof window !== "undefined" ? window.innerHeight - 300 : y),
  };

  return (
    <div
      ref={ref}
      className="ide-context-menu"
      style={style}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (isSeparator(item)) {
          return <div key={`sep-${idx}`} className="ide-context-sep" />;
        }
        return (
          <button
            key={item.id}
            className={`ide-context-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onSelect(item.id);
              onClose();
            }}
            role="menuitem"
          >
            <span className="ide-context-label">
              {item.icon ? <span className="ide-context-icon">{item.icon}</span> : null}
              {item.label}
            </span>
            {item.shortcut ? <span className="ide-context-shortcut">{item.shortcut}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
