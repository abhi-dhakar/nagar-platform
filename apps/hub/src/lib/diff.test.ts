import assert from "node:assert/strict";
import test from "node:test";
import { classifyDiffLine, formatBytes } from "./diff";

test("diff lines are classified for display", () => {
  assert.equal(classifyDiffLine("diff --git a/x.ts b/x.ts"), "file");
  assert.equal(classifyDiffLine("@@ -1,3 +1,4 @@ function f()"), "hunk");
  assert.equal(classifyDiffLine("+const added = true;"), "add");
  assert.equal(classifyDiffLine("-const removed = true;"), "del");
  assert.equal(classifyDiffLine(" unchanged context"), "context");
  assert.equal(classifyDiffLine(""), "context");
});

test("file headers are metadata, not additions or deletions", () => {
  assert.equal(classifyDiffLine("+++ b/src/app.ts"), "meta");
  assert.equal(classifyDiffLine("--- a/src/app.ts"), "meta");
  assert.equal(classifyDiffLine("index 83db48f..bf2a3c1 100644"), "meta");
  assert.equal(classifyDiffLine("new file mode 100644"), "meta");
  assert.equal(classifyDiffLine("deleted file mode 100644"), "meta");
  assert.equal(classifyDiffLine("Binary files a/logo.png and b/logo.png differ"), "meta");
  assert.equal(classifyDiffLine("\\ No newline at end of file"), "meta");
});

test("a removed line that starts with dashes is still a removal", () => {
  assert.equal(classifyDiffLine("--- not a header, a deleted YAML separator"), "meta");
  assert.equal(classifyDiffLine("-- deleted SQL comment"), "del");
});

test("byte sizes are human readable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
