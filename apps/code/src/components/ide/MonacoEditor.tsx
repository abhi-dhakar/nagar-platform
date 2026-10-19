"use client";

import { useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { useSettings } from "@/lib/settings/context";

type Props = {
  path: string | null;
  language: string;
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
};

export function MonacoEditor({ path, language, value, onChange, onSave, onMount }: Props) {
  const { settings } = useSettings();
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    // Configure Monaco themes once
    loader.init().then((monaco) => {
      // Nagar Dark — deep ink with lime/blue accents
      monaco.editor.defineTheme("nagar-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6A7B6B", fontStyle: "italic" },
          { token: "keyword", foreground: "BAFF69" },
          { token: "string", foreground: "FFD60A" },
          { token: "number", foreground: "FF8A5B" },
          { token: "type", foreground: "7AA2FF" },
          { token: "class", foreground: "C9A7FF" },
        ],
        colors: {
          "editor.background": "#0F1410",
          "editor.foreground": "#E6E8E3",
          "editor.lineHighlightBackground": "#1A231B",
          "editorLineNumber.foreground": "#5A665B",
          "editorLineNumber.activeForeground": "#E6E8E3",
          "editorCursor.foreground": "#BAFF69",
          "editor.selectionBackground": "#2A3A2E",
          "editor.inactiveSelectionBackground": "#1E2A21",
          "editorIndentGuide.background": "#1E2A21",
          "editorIndentGuide.activeBackground": "#2F3D32",
          "editorGutter.background": "#0F1410",
          "scrollbarSlider.background": "#2A3A2EAA",
          "scrollbarSlider.hoverBackground": "#3A4A3EAA",
          "minimap.background": "#111611",
          "editorWidget.background": "#1A231B",
          "editorSuggestWidget.background": "#1A231B",
          "editorSuggestWidget.foreground": "#E6E8E3",
          "editorSuggestWidget.selectedBackground": "#2A3A2E",
        },
      });

      monaco.editor.defineTheme("nagar-light", {
        base: "vs",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6B7A6A", fontStyle: "italic" },
          { token: "keyword", foreground: "1A5CFF" },
          { token: "string", foreground: "B65C00" },
          { token: "type", foreground: "0E4DA4" },
        ],
        colors: {
          "editor.background": "#FFFDF4",
          "editor.foreground": "#111111",
          "editor.lineHighlightBackground": "#FFF6A6",
          "editorLineNumber.foreground": "#9AA09A",
          "editorCursor.foreground": "#111111",
          "editor.selectionBackground": "#EDFF00",
          "minimap.background": "#FFFDF4",
        },
      });
    });
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    // Expose editor for parent if needed
    onMount?.(editor, monaco);

    // Ctrl+S handled globally, but also add Monaco keybinding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Ensure find widget works; Monaco already binds Ctrl+F
    editor.focus();
  };

  // Map settings to Monaco theme id
  const monacoTheme =
    settings.theme === "nagar-dark"
      ? "nagar-dark"
      : settings.theme === "nagar-light"
        ? "nagar-light"
        : settings.theme === "vs-light"
          ? "vs"
          : "vs-dark";

  return (
    <div className="ide-monaco-wrap">
      <Editor
        key={path ?? "untitled"}
        language={language}
        value={value}
        theme={monacoTheme}
        {...(path ? { path } : {})}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          fontSize: settings.fontSize,
          fontFamily: settings.fontFamily,
          lineNumbers: settings.lineNumbers as never,
          wordWrap: settings.wordWrap as never,
          minimap: { enabled: settings.minimap },
          tabSize: settings.tabSize,
          insertSpaces: true,
          detectIndentation: false,
          folding: true,
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: "never",
            seedSearchStringFromSelection: "always",
          },
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: "on",
          tabCompletion: "on",
          // Accessibility
          ariaLabel: path ? `Editing ${path}` : "Untitled editor",
          foldingStrategy: "indentation",
        }}
        loading={<div className="ide-monaco-loading">Loading editor…</div>}
      />
    </div>
  );
}
