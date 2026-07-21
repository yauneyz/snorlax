#!/usr/bin/env node
/** Build and publish Linux, then cross-build and publish Windows, from a Linux host. */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux") {
  throw new Error("release:both must run on Linux.");
}

const forwarded = process.argv.slice(2).filter((arg) => arg !== "--");
const env = { ...process.env, APP_ENV: "production" };

console.log(
  "\n=== Publish Linux release (including signed APT repository) ===",
);
execFileSync(
  process.execPath,
  [
    join(root, "scripts/upload-release.mjs"),
    "--require",
    "linux",
    ...forwarded,
  ],
  { cwd: root, env, stdio: "inherit" },
);

console.log("\n=== Cross-build and publish Windows release ===");
execFileSync(
  process.execPath,
  [join(root, "scripts/release-win-from-linux.mjs"), ...forwarded],
  { cwd: root, env, stdio: "inherit" },
);

console.log("\nLinux and Windows releases completed successfully.");
