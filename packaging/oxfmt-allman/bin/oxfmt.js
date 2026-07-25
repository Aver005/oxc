#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

/**
 * Node reports "linux" for both glibc and musl systems, but the two need different binaries.
 * `glibcVersionRuntime` is present only when the process is actually linked against glibc,
 * which is the check esbuild/swc/napi-rs all settled on.
 */
function detectLibc() {
  if (process.platform !== "linux") return null;
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : {};
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
}

function targetName() {
  const { platform, arch } = process;
  const libc = detectLibc();

  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  if (platform === "win32" && arch === "arm64") return "win32-arm64-msvc";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return `linux-x64-${libc}`;
  if (platform === "linux" && arch === "arm64") return `linux-arm64-${libc}`;
  return null;
}

const target = targetName();

if (target === null) {
  console.error(
    `oxfmt-allman: unsupported platform ${process.platform}-${process.arch}.\n` +
      `Build one with: cargo build -p oxfmt --release --no-default-features`,
  );
  process.exit(1);
}

const pkg = `@artemiy/oxfmt-allman-${target}`;
const suffix = process.platform === "win32" ? ".exe" : "";

let binary;
try {
  binary = require.resolve(`${pkg}/oxfmt${suffix}`);
} catch {
  console.error(
    `oxfmt-allman: the binary package ${pkg} is not installed.\n` +
      `It is an optional dependency, so npm skips it silently when the registry is\n` +
      `unreachable or unauthenticated. Re-run the install with the registry configured:\n` +
      `  npm i -D @artemiy/oxfmt-allman --foreground-scripts`,
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(`oxfmt-allman: failed to run ${binary}\n${result.error.message}`);
  process.exit(1);
}

// A process killed by a signal reports a null status; report it as a failure
// rather than silently exiting 0.
process.exit(result.status === null ? 1 : result.status);
