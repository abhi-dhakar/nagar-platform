"use client";

import { useSettings } from "@/lib/settings/context";
import { fontSizeOptions, tabSizeOptions, themeOptions } from "@/lib/settings/defaults";

export function SettingsPanel() {
  const { settings, update, reset } = useSettings();

  return (
    <div className="ide-settings-panel">
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">Settings</h2>
        <button className="ide-secondary-btn small" onClick={reset}>
          Reset
        </button>
      </div>

      <div className="ide-settings-body">
        <section className="ide-settings-section">
          <h3>Appearance</h3>
          <label className="ide-field">
            <span className="ide-field-label">Theme</span>
            <select
              className="ide-select"
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value as never })}
            >
              {themeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {o.description}
                </option>
              ))}
            </select>
            <span className="ide-field-hint">Nagar Dark is the default. Changes apply instantly to the editor.</span>
          </label>

          <label className="ide-field">
            <span className="ide-field-label">Font size</span>
            <select
              className="ide-select"
              value={settings.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) as never })}
            >
              {fontSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </select>
          </label>

          <label className="ide-field">
            <span className="ide-field-label">Font family</span>
            <input
              className="ide-input"
              value={settings.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
            />
            <span className="ide-field-hint">Monospace stack used by Monaco. Reload is not required.</span>
          </label>
        </section>

        <section className="ide-settings-section">
          <h3>Editor</h3>
          <label className="ide-field">
            <span className="ide-field-label">Tab size</span>
            <select
              className="ide-select"
              value={settings.tabSize}
              onChange={(e) => update({ tabSize: Number(e.target.value) as never })}
            >
              {tabSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n} spaces
                </option>
              ))}
            </select>
          </label>

          <label className="ide-field">
            <span className="ide-field-label">Word wrap</span>
            <select
              className="ide-select"
              value={settings.wordWrap}
              onChange={(e) => update({ wordWrap: e.target.value as never })}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
              <option value="wordWrapColumn">Wrap at column</option>
              <option value="bounded">Bounded</option>
            </select>
          </label>

          <label className="ide-field checkbox">
            <input
              type="checkbox"
              checked={settings.minimap}
              onChange={(e) => update({ minimap: e.target.checked })}
            />
            <span>Show minimap</span>
          </label>

          <label className="ide-field checkbox">
            <input
              type="checkbox"
              checked={settings.lineNumbers === "on"}
              onChange={(e) => update({ lineNumbers: e.target.checked ? "on" : "off" })}
            />
            <span>Show line numbers</span>
          </label>

          <label className="ide-field checkbox">
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={(e) => update({ autoSave: e.target.checked })}
            />
            <span>Auto-save on edit (debounced)</span>
          </label>
        </section>

        <section className="ide-settings-section">
          <h3>Keyboard</h3>
          <div className="ide-kbd-table">
            <div className="ide-kbd-row">
              <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">S</span>
              <span>Save file</span>
            </div>
            <div className="ide-kbd-row">
              <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">⇧</span> + <span className="ide-kbd">P</span>
              <span>Command palette</span>
            </div>
            <div className="ide-kbd-row">
              <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">W</span>
              <span>Close tab</span>
            </div>
            <div className="ide-kbd-row">
              <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">F</span>
              <span>Find (Monaco)</span>
            </div>
            <div className="ide-kbd-row">
              <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">H</span>
              <span>Find &amp; Replace (Monaco)</span>
            </div>
          </div>
        </section>

        <p className="ide-muted small">
          Settings persist in <code>localStorage</code> under <code>nagarcode:settings:v1</code>. They are applied via
          the Monaco options API — no server round-trip.
        </p>
      </div>
    </div>
  );
}
