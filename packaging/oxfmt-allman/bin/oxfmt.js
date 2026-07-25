#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// Every binary is bundled in this one package rather than split into per-platform packages
// pulled in through optionalDependencies. GitLab's npm registry serves a minimal packument
// that drops `optionalDependencies`, `os` and `cpu`, so npm would never learn the
// per-platform packages exist. See README, "Why a single package".

/**
 * Node reports "linux" for both glibc and musl systems, but the two need different binaries.
 * `glibcVersionRuntime` is present only when the process is actually linked against glibc,
 * which is the check esbuild/swc/napi-rs all settled on.
 */
function detectLibc() {
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : {};
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
}

function targetName() {
  const { platform, arch } = process;

  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  if (platform === "win32" && arch === "arm64") return "win32-arm64-msvc";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return `linux-x64-${detectLibc()}`;
  if (platform === "linux" && arch === "arm64") return `linux-arm64-${detectLibc()}`;
  return null;
}

const binariesDir = join(__dirname, "..", "binaries");
const target = targetName();
const suffix = process.platform === "win32" ? ".exe" : "";
const binary = target === null ? null : join(binariesDir, `oxfmt-${target}${suffix}`);

if (binary === null || !existsSync(binary)) {
  const bundled = existsSync(binariesDir)
    ? readdirSync(binariesDir)
        .map((f) => f.replace(/^oxfmt-/, "").replace(/\.exe$/, ""))
        .join(", ") || "none"
    : "none";
  console.error(
    `oxfmt-allman: no bundled binary for ${process.platform}-${process.arch}.\n` +
      `Bundled targets: ${bundled}\n` +
      `Build one with: cargo build -p oxfmt --release --no-default-features`,
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
