#!/usr/bin/env node
// Collects the binaries dropped into `artifacts/` into a single `binaries/` directory that
// ships inside the one published package.
//
// Expected artifact layout (this is what the CI jobs upload):
//   artifacts/<target>/oxfmt        e.g. artifacts/linux-x64-gnu/oxfmt
//   artifacts/<target>/oxfmt.exe    e.g. artifacts/win32-x64-msvc/oxfmt.exe
//
// Why not per-platform packages behind optionalDependencies, the way esbuild and swc do it:
// GitLab's npm registry serves a minimal packument. For a published package it returns only
// `bin`, `dist`, `engines`, `name` and `version` — `optionalDependencies`, `os` and `cpu` are
// dropped. npm resolves dependencies from the packument rather than from the tarball, so it
// would never install the platform package and `oxfmt` would be a binary-less shim.
// Verified against GitLab 17.9.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactsDir = join(root, "artifacts");
const binariesDir = join(root, "binaries");

/** Targets the shim knows how to select, mapped to whether they are Windows. */
const TARGETS = {
  "win32-x64-msvc": true,
  "win32-arm64-msvc": true,
  "darwin-x64": false,
  "darwin-arm64": false,
  "linux-x64-gnu": false,
  "linux-x64-musl": false,
  "linux-arm64-gnu": false,
  "linux-arm64-musl": false,
};

const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));

if (!existsSync(artifactsDir)) {
  console.error(`no artifacts/ directory at ${artifactsDir}`);
  process.exit(1);
}

rmSync(binariesDir, { recursive: true, force: true });
mkdirSync(binariesDir, { recursive: true });

const bundled = [];
let totalBytes = 0;

for (const target of readdirSync(artifactsDir)) {
  if (!(target in TARGETS)) {
    console.warn(`skipping artifacts/${target}: not a known target`);
    continue;
  }

  const isWindows = TARGETS[target];
  const binaryName = isWindows ? "oxfmt.exe" : "oxfmt";
  const source = join(artifactsDir, target, binaryName);

  if (!existsSync(source)) {
    console.warn(`skipping ${target}: no ${binaryName} in artifacts/${target}`);
    continue;
  }

  const destination = join(binariesDir, `oxfmt-${target}${isWindows ? ".exe" : ""}`);
  copyFileSync(source, destination);
  if (!isWindows) {
    // npm preserves the mode recorded in the tarball, so it has to be right before packing.
    chmodSync(destination, 0o755);
  }

  totalBytes += statSync(destination).size;
  bundled.push(target);
}

if (bundled.length === 0) {
  console.error("no binaries found in artifacts/ — nothing to package");
  process.exit(1);
}

// Earlier versions of this package used optionalDependencies; make sure a stale entry
// cannot survive into a fresh publish.
if (rootPkg.optionalDependencies) {
  delete rootPkg.optionalDependencies;
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
}

console.log(
  `bundled ${bundled.length} binaries (${(totalBytes / 1024 / 1024).toFixed(1)} MiB uncompressed) ` +
    `at version ${rootPkg.version}:`,
);
for (const target of bundled) console.log(`  ${target}`);
