"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands
      .filter((c) => {
        const hay = `${c.category} ${c.label} ${c.keywords?.join(" ") ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="ide-command-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ide-command-box">
        <div className="ide-command-input-wrap">
          <span className="ide-command-icon">⌘</span>
          <input
            ref={inputRef}
            className="ide-command-input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const cmd = filtered[selected];
                if (cmd) {
                  cmd.run();
                  onClose();
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            aria-label="Command search"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="ide-command-esc" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>

        <div className="ide-command-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="ide-command-empty">No commands matching “{query}”</div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                className={`ide-command-item ${idx === selected ? "selected" : ""}`}
                role="option"
                aria-selected={idx === selected}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <span className="ide-command-cat">{cmd.category}</span>
                <span className="ide-command-label">{cmd.label}</span>
                {cmd.shortcut ? <span className="ide-command-shortcut">{cmd.shortcut}</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="ide-command-foot">
          <span>
            <span className="ide-kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="ide-kbd">↵</span> run
          </span>
          <span>
            <span className="ide-kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
