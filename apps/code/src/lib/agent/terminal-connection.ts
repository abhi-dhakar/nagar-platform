"use client";

import type { TerminalServerMessage } from "@nagar/agent-protocol";
import type { AgentClient } from "./client";

export type TerminalConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export type TerminalConnectionHandlers = {
  onReady: (message: Extract<TerminalServerMessage, { type: "ready" }>) => void;
  onData: (data: string) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
  onError: (message: string) => void;
  onState: (state: TerminalConnectionState) => void;
};

const MAX_RECONNECT_ATTEMPTS = 3;

export class TerminalConnection {
  private readonly client: AgentClient;
  private readonly sessionId: string;
  private readonly handlers: TerminalConnectionHandlers;
  private socket: WebSocket | null = null;
  private disposed = false;
  private exited = false;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private pendingSize: { cols: number; rows: number } | null = null;

  constructor(client: AgentClient, sessionId: string, handlers: TerminalConnectionHandlers) {
    this.client = client;
    this.sessionId = sessionId;
    this.handlers = handlers;
  }

  connect(): void {
    if (this.disposed) return;
    this.handlers.onState(this.attempts > 0 ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        this.client.terminalWebSocketUrl(this.sessionId),
        this.client.terminalProtocols(),
      );
    } catch (error) {
      this.handlers.onError(
        `Could not open the terminal WebSocket: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.handlers.onState("closed");
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.disposed) {
        socket.close();
        return;
      }
      const reconnected = this.attempts > 0;
      this.attempts = 0;
      this.handlers.onState("open");
      if (reconnected)
        this.handlers.onData("\r\n\u001b[90m[reconnected to the local agent]\u001b[0m\r\n");
      if (this.pendingSize) {
        this.send({ type: "resize", cols: this.pendingSize.cols, rows: this.pendingSize.rows });
        this.pendingSize = null;
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: TerminalServerMessage;
      try {
        message = JSON.parse(event.data) as TerminalServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case "ready":
          this.handlers.onReady(message);
          break;
        case "data":
          this.handlers.onData(message.data);
          break;
        case "exit":
          this.exited = true;
          this.handlers.onExit(message.exitCode, message.signal);
          break;
        case "error":
          this.handlers.onError(message.message);
          break;
        case "pong":
          break;
      }
    };
    socket.onerror = () => {
      // The close handler carries the retry/state logic; browsers hide details.
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.disposed) {
        this.handlers.onState("closed");
        return;
      }
      if (this.exited) {
        this.handlers.onState("closed");
        return;
      }
      if (this.attempts < MAX_RECONNECT_ATTEMPTS) {
        this.attempts += 1;
        this.handlers.onState("reconnecting");
        const delay = 400 * this.attempts;
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delay);
      } else {
        this.handlers.onState("closed");
        this.handlers.onError(
          "Terminal connection lost. The agent may have stopped or the session may have closed.",
        );
      }
    };
  }

  private send(message: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  sendInput(data: string): void {
    if (!data) return;
    this.send({ type: "input", data });
  }

  resize(cols: number, rows: number): void {
    const size = {
      cols: Math.max(2, Math.min(500, Math.round(cols))),
      rows: Math.max(2, Math.min(200, Math.round(rows))),
    };
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: "resize", ...size });
    } else {
      this.pendingSize = size;
    }
  }

  interrupt(): void {
    this.send({ type: "interrupt" });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close(1000, "terminal view closed");
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
