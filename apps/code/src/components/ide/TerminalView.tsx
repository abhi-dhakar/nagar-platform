"use client";

import "@xterm/xterm/css/xterm.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { TerminalSessionInfo } from "@nagar/agent-protocol";
import type { AgentClient } from "@/lib/agent/client";
import { TerminalConnection, type TerminalConnectionState } from "@/lib/agent/terminal-connection";

export type TerminalViewHandle = {
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  clear: () => void;
  focus: () => void;
};

type Props = {
  client: AgentClient | null;
  session: TerminalSessionInfo;
  active: boolean;
  fontSize: number;
  fontFamily: string;
  lightTheme: boolean;
  onSessionStatus: (
    patch: Partial<Pick<TerminalSessionInfo, "status" | "exitCode" | "signal" | "cols" | "rows">>,
  ) => void;
  onRefreshExplorer: () => void;
};

function themeFor(light: boolean) {
  return light
    ? {
        background: "#fffdf4",
        foreground: "#111111",
        cursor: "#111111",
        cursorAccent: "#fffdf4",
        selectionBackground: "#edff00",
        black: "#111111",
        red: "#b42318",
        green: "#0a7a33",
        yellow: "#8a5a00",
        blue: "#1a4fd6",
        magenta: "#8b1ecb",
        cyan: "#0b6e75",
        white: "#e6e8e3",
      }
    : {
        background: "#0e140f",
        foreground: "#e6e8e3",
        cursor: "#baff69",
        cursorAccent: "#0e140f",
        selectionBackground: "#2a3a2e",
        black: "#0c1010",
        red: "#ff644e",
        green: "#baff69",
        yellow: "#ffd60a",
        blue: "#7aa2ff",
        magenta: "#c9a7ff",
        cyan: "#67e8f9",
        white: "#e6e8e3",
      };
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

async function readClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  return "";
}

export const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView(
  { client, session, active, fontSize, fontFamily, lightTheme, onSessionStatus, onRefreshExplorer },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const connectionRef = useRef<TerminalConnection | null>(null);
  const handlersRef = useRef({ onSessionStatus, onRefreshExplorer });
  handlersRef.current = { onSessionStatus, onRefreshExplorer };
  const activeRef = useRef(active);
  activeRef.current = active;

  useImperativeHandle(
    ref,
    () => ({
      async copy() {
        const term = termRef.current;
        if (!term) return;
        const selection = term.getSelection();
        if (!selection) {
          term.write("\r\n\u001b[90m[select text in the terminal before copying]\u001b[0m\r\n");
          return;
        }
        try {
          await copyText(selection);
          term.focus();
        } catch {
          term.write("\r\n\u001b[31m[clipboard permission denied]\u001b[0m\r\n");
        }
      },
      async paste() {
        const term = termRef.current;
        if (!term) return;
        try {
          const text = await readClipboard();
          if (text) term.paste(text);
          term.focus();
        } catch {
          term.write(
            "\r\n\u001b[31m[clipboard read permission denied — use Ctrl+Shift+V or your browser paste shortcut]\u001b[0m\r\n",
          );
        }
      },
      clear() {
        termRef.current?.clear();
        termRef.current?.focus();
      },
      focus() {
        termRef.current?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!client) {
      termRef.current?.write(
        "\r\n\u001b[33m[local agent disconnected — reconnect to continue this terminal]\u001b[0m\r\n",
      );
      return;
    }
    if (!container) return;

    let disposed = false;
    let fitFrame = 0;
    let resizeTimer: number | null = null;
    let cleanup: (() => void) | null = null;

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cols: Math.max(20, session.cols || 80),
        rows: Math.max(5, session.rows || 24),
        scrollback: 8000,
        fontFamily,
        fontSize,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: false,
        theme: themeFor(lightTheme),
        allowTransparency: false,
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
        scrollOnUserInput: true,
        smoothScrollDuration: 0,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      termRef.current = term;
      fitRef.current = fit;
      term.writeln(
        "\u001b[90mNagarCode terminal — real local process. Ctrl+C interrupts; Ctrl+Shift+C / Ctrl+Shift+V copy and paste.\u001b[0m",
      );

      const applyFit = () => {
        if (disposed || !activeRef.current) return;
        try {
          const proposed = fit.proposeDimensions();
          if (!proposed || proposed.cols < 2 || proposed.rows < 2) return;
          fit.fit();
        } catch {
          // The container may be hidden during panel transitions.
        }
      };
      fitFrame = window.requestAnimationFrame(applyFit);

      let attachedOnce = false;
      let exited = session.status === "exited";
      const connection = new TerminalConnection(client, session.id, {
        onReady: (message) => {
          if (attachedOnce) term.reset();
          attachedOnce = true;
          if (message.session.status === "exited") {
            exited = true;
            handlersRef.current.onSessionStatus({
              status: "exited",
              exitCode: message.session.exitCode,
              signal: message.session.signal,
            });
          }
          applyFit();
        },
        onData: (data) => {
          term.write(data);
        },
        onExit: (exitCode, signal) => {
          exited = true;
          handlersRef.current.onSessionStatus({ status: "exited", exitCode, signal });
          const signalText = signal ? `, signal ${signal}` : "";
          term.write(
            `\r\n\u001b[90m[process exited with ${exitCode === null ? "an unknown code" : `code ${exitCode}`}${signalText}]\u001b[0m\r\n`,
          );
          handlersRef.current.onRefreshExplorer();
        },
        onError: (message) => {
          term.write(`\r\n\u001b[31m[agent] ${message}\u001b[0m\r\n`);
        },
        onState: (connectionState: TerminalConnectionState) => {
          if (connectionState === "reconnecting") {
            term.write(
              "\r\n\u001b[33m[connection lost — reconnecting to the local agent]\u001b[0m\r\n",
            );
          } else if (connectionState === "closed" && !exited) {
            term.write("\r\n\u001b[31m[terminal disconnected]\u001b[0m\r\n");
          }
        },
      });
      connectionRef.current = connection;
      connection.connect();

      const resizeDisposable = term.onResize(() => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          handlersRef.current.onSessionStatus({ cols: term.cols, rows: term.rows });
          connection.resize(term.cols, term.rows);
        }, 120);
      });

      term.onData((data) => {
        connection.sendInput(data);
      });

      const copySelection = async () => {
        const selection = term.getSelection();
        if (!selection) return;
        try {
          await copyText(selection);
          term.focus();
        } catch {
          term.write("\r\n\u001b[31m[clipboard permission denied]\u001b[0m\r\n");
        }
      };
      const pasteClipboard = async () => {
        try {
          const text = await readClipboard();
          if (text) term.paste(text);
          term.focus();
        } catch {
          term.write("\r\n\u001b[31m[clipboard read permission denied]\u001b[0m\r\n");
        }
      };
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.shiftKey && event.code === "KeyC") {
          void copySelection();
          return false;
        }
        if (modifier && event.shiftKey && event.code === "KeyV") {
          void pasteClipboard();
          return false;
        }
        return true;
      });

      const observer = new ResizeObserver(() => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(applyFit, 120);
      });
      observer.observe(container);

      if (activeRef.current) {
        window.requestAnimationFrame(() => {
          applyFit();
          term.focus();
        });
      }

      cleanup = () => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeDisposable.dispose();
        observer.disconnect();
        connection.dispose();
        term.dispose();
        if (termRef.current === term) termRef.current = null;
        if (fitRef.current === fit) fitRef.current = null;
        if (connectionRef.current === connection) connectionRef.current = null;
      };
    };

    void setup().catch((error: unknown) => {
      if (!disposed && container) {
        container.textContent = `Could not load xterm.js: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

    return () => {
      disposed = true;
      if (fitFrame) window.cancelAnimationFrame(fitFrame);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (cleanup) cleanup();
      else {
        connectionRef.current?.dispose();
        connectionRef.current = null;
        termRef.current?.dispose();
        termRef.current = null;
        fitRef.current = null;
      }
    };
  }, [client, session.id, fontFamily, fontSize, lightTheme]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      termRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  const style: CSSProperties = active ? { display: "block" } : { display: "none" };
  return (
    <div ref={containerRef} className="ide-terminal-view" style={style} aria-hidden={!active} />
  );
});
