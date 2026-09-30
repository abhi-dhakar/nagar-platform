/* global process */
// Runs every `*.test.ts(x)` under src/ with the Node test runner. Next.js needs
// `jsx: "preserve"`, so the tests use tsconfig.test.json (automatic JSX runtime) instead.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.test\.tsx?$/.test(entry)) files.push(path);
  }
})(join(root, "src"));
files.sort();

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TSX_TSCONFIG_PATH: join(root, "tsconfig.test.json"), NODE_ENV: "test" },
});
process.exit(result.status ?? 1);
