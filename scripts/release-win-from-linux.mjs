#!/usr/bin/env node
/** Cross-build, sign, and publish the x64 Windows release from a Linux host. */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux") {
  throw new Error(
    "release:upload:win is the Linux-to-Windows release path and must run on Linux.",
  );
}

const forwarded = process.argv.slice(2).filter((arg) => arg !== "--");
const env = { ...process.env, APP_ENV: "production" };

execFileSync(
  process.execPath,
  [join(root, "scripts/build.mjs"), "--target", "win", "--cross"],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);
execFileSync(
  process.execPath,
  [
    join(root, "scripts/upload-release.mjs"),
    "--no-build",
    "--require",
    "win",
    ...forwarded,
  ],
  { cwd: root, env, stdio: "inherit" },
);
