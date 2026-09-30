/* global process */
// Discovers every `*.test.ts` under test/ and runs them with the Node test runner.
// A plain discovery script keeps `pnpm test` working on Windows, where `test/**/*.ts`
// would not be expanded by the shell, and means new test files need no registration.
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

const result = spawnSync(
  process.execPath,
  ["--import", join(root, "setup.mjs"), "--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
