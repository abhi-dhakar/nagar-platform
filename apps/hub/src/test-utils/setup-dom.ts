import { JSDOM } from "jsdom";

/**
 * Installs a jsdom window as the global browser. This module must be evaluated BEFORE react-dom
 * is imported: React decides whether it is running in a browser (`canUseDOM`) once, at import
 * time, and without this it would ignore input events. `dom.ts` therefore imports it first.
 * Each test file runs in its own process, so globals never leak between files.
 */
export const jsdom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
});

const target = globalThis as unknown as Record<string, unknown>;
for (const name of Object.getOwnPropertyNames(jsdom.window)) {
  if (name in globalThis) continue; // keep Node's own fetch, URL, Response, timers, …
  try {
    target[name] = (jsdom.window as unknown as Record<string, unknown>)[name];
  } catch {
    /* read-only global */
  }
}
target.window = jsdom.window;
target.document = jsdom.window.document;
target.IS_REACT_ACT_ENVIRONMENT = true;
