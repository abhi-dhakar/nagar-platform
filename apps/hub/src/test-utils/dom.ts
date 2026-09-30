// Must stay first: installs the jsdom globals before react-dom is imported (see setup-dom.ts).
import { jsdom } from "./setup-dom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A minimal browser for component tests: React's `act` environment, a mountable root, and a
 * scriptable `fetch`. Kept dependency-free on purpose (no testing-library).
 */
let root: Root | undefined;
let originalFetch: typeof fetch | undefined;

export function installDom(): void {
  originalFetch = globalThis.fetch;
}

export async function cleanupDom(): Promise<void> {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  if (originalFetch) globalThis.fetch = originalFetch;
  jsdom.window.close();
}

export async function mount(element: ReactElement): Promise<HTMLElement> {
  const container = document.getElementById("root") as HTMLElement;
  if (root) await act(async () => root?.unmount());
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  return container;
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
export type FetchReply = { status?: number; body: unknown };
export type FetchRoute = (
  call: FetchCall,
) => FetchReply | undefined | Promise<FetchReply | undefined>;

/** Replaces `fetch`; the first route returning a reply wins, anything unmatched is a 404. */
export function stubFetch(...routes: FetchRoute[]): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const route of routes) {
      const reply = await route(call);
      if (reply)
        return new Response(JSON.stringify(reply.body), {
          status: reply.status ?? 200,
          headers: { "content-type": "application/json" },
        });
    }
    return new Response(
      JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Not stubbed." } }),
      { status: 404 },
    );
  }) as typeof fetch;
  return calls;
}

export const ok = (data: unknown): FetchReply => ({ body: { success: true, data } });
export const fail = (status: number, code: string, message: string): FetchReply => ({
  status,
  body: { success: false, error: { code, message } },
});

export async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export async function waitFor<T>(check: () => T | null | undefined | false, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the UI to update.");
    await settle(15);
  }
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Types into a React-controlled input the way a browser would (native setter + input event). */
export async function type(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  });
}

export const text = (element: Element | null | undefined) => element?.textContent?.trim() ?? "";
export const buttons = (container: HTMLElement) =>
  [...container.querySelectorAll("button")] as HTMLButtonElement[];
export const buttonLabelled = (container: HTMLElement, label: RegExp | string) =>
  buttons(container).find((button) =>
    typeof label === "string" ? text(button) === label : label.test(text(button)),
  );
