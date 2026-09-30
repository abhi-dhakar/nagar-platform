import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "./markdown";

const render = (source: string) => renderToStaticMarkup(<MarkdownBody>{source}</MarkdownBody>);

test("README headings, emphasis, code, lists, and GFM tables render", () => {
  const html = render(
    "# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n",
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
});

test("raw HTML in a README is shown as text, never executed", () => {
  const html = render(
    'Hello <script>alert("xss")</script> <img src=x onerror="alert(1)"> <iframe src="https://evil.example"></iframe>',
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.match(html, /&lt;script&gt;/);
});

test("javascript: and data: URLs are dropped from links and images", () => {
  const html = render(
    "[click me](javascript:alert(1)) ![x](javascript:alert(2)) [d](data:text/html;base64,PHNjcmlwdD4=) [ok](https://example.com)",
  );
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /data:text\/html/i);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test("links open in a new tab without leaking the opener", () => {
  const html = render("[docs](https://example.com/docs)");
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
});
