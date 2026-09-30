import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./diff-view";

const sample = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1,2 @@",
  " kept",
  "-old",
  "+new",
].join("\n");

test("added, removed, hunk, and file lines get their own styling", () => {
  const html = renderToStaticMarkup(<DiffView diff={sample} />);
  assert.match(html, /class="diff-line file"/);
  assert.match(html, /class="diff-line hunk"/);
  assert.match(html, /class="diff-line add">\+new</);
  assert.match(html, /class="diff-line del">-old</);
  assert.match(html, /class="diff-line meta">\+\+\+ b\/a\.txt</);
});

test("diff content is always escaped, even when it looks like markup", () => {
  const html = renderToStaticMarkup(
    <DiffView diff={'+<script>alert("pwned")</script>\n+<img src=x onerror=alert(1)>'} />,
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;pwned&quot;\)&lt;\/script&gt;/);
});

test("an empty diff says so instead of rendering an empty box", () => {
  assert.match(renderToStaticMarkup(<DiffView diff="   " />), /No textual changes/);
});
