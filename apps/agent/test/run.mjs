/* global process */
// Discovers every `*.test.ts` under test/ and runs it with the Node test runner.
// The same shape is used by services/api so `pnpm test` works on Windows too.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const files = [];
(function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith(".test.ts")) files.push(path);
  }
})(root);
files.sort();

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});
process.exit(result.status ?? 1);
