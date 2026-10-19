export type ThemeId = "nagar-dark" | "nagar-light" | "vs-dark" | "vs-light";
export type WordWrap = "off" | "on" | "wordWrapColumn" | "bounded";
export type TabSize = 2 | 4 | 8;

export type EditorSettings = {
  theme: ThemeId;
  fontSize: number;
  tabSize: TabSize;
  wordWrap: WordWrap;
  minimap: boolean;
  fontFamily: string;
  lineNumbers: "on" | "off" | "relative";
  autoSave: boolean;
};

export const defaultSettings: EditorSettings = {
  theme: "nagar-dark",
  fontSize: 13,
  tabSize: 2,
  wordWrap: "off",
  minimap: true,
  fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  lineNumbers: "on",
  autoSave: false,
};

export const themeOptions: { id: ThemeId; label: string; description: string }[] = [
  { id: "nagar-dark", label: "Nagar Dark", description: "Default dark — ink, lime, electric blue" },
  { id: "nagar-light", label: "Nagar Light", description: "Paper and ink — Neo-brutalist light" },
  { id: "vs-dark", label: "Dark (VS)", description: "VS Code dark fallback" },
  { id: "vs-light", label: "Light (VS)", description: "VS Code light fallback" },
];

export const fontSizeOptions = [11, 12, 13, 14, 15, 16, 18, 20];
export const tabSizeOptions: TabSize[] = [2, 4, 8];
