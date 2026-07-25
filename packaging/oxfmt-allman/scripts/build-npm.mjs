#!/usr/bin/env node
// Turns the binaries dropped into `artifacts/` into per-platform npm packages under `npm/`,
// and rewrites the root package's `optionalDependencies` to match exactly what was found.
//
// Expected artifact layout (this is what the CI jobs upload):
//   artifacts/<target>/oxfmt        e.g. artifacts/linux-x64-gnu/oxfmt
//   artifacts/<target>/oxfmt.exe    e.g. artifacts/win32-x64-msvc/oxfmt.exe
//
// Only targets that actually have a binary are packaged, so a partial CI run publishes a
// coherent set instead of a root package pointing at things that do not exist.

import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactsDir = join(root, "artifacts");
const outDir = join(root, "npm");

/** target -> npm `os` / `cpu` / `libc` triple used to pick the right package at install time. */
const TARGETS = {
  "win32-x64-msvc": { os: ["win32"], cpu: ["x64"] },
  "win32-arm64-msvc": { os: ["win32"], cpu: ["arm64"] },
  "darwin-x64": { os: ["darwin"], cpu: ["x64"] },
  "darwin-arm64": { os: ["darwin"], cpu: ["arm64"] },
  "linux-x64-gnu": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
  "linux-x64-musl": { os: ["linux"], cpu: ["x64"], libc: ["musl"] },
  "linux-arm64-gnu": { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
  "linux-arm64-musl": { os: ["linux"], cpu: ["arm64"], libc: ["musl"] },
};

const rootPkgPath = join(root, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const { version } = rootPkg;

if (!existsSync(artifactsDir)) {
  console.error(`no artifacts/ directory at ${artifactsDir}`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const optionalDependencies = {};
const built = [];

for (const target of readdirSync(artifactsDir)) {
  const meta = TARGETS[target];
  if (!meta) {
    console.warn(`skipping artifacts/${target}: not a known target`);
    continue;
  }

  const isWindows = meta.os[0] === "win32";
  const binaryName = isWindows ? "oxfmt.exe" : "oxfmt";
  const source = join(artifactsDir, target, binaryName);

  if (!existsSync(source)) {
    console.warn(`skipping ${target}: no ${binaryName} in artifacts/${target}`);
    continue;
  }

  const name = `@artemiy/oxfmt-allman-${target}`;
  const pkgDir = join(outDir, target);
  mkdirSync(pkgDir, { recursive: true });

  cpSync(source, join(pkgDir, binaryName));
  if (!isWindows) {
    // npm preserves the mode from the tarball, so it has to be right before packing.
    chmodSync(join(pkgDir, binaryName), 0o755);
  }

  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        description: `${target} binary for @artemiy/oxfmt-allman`,
        license: rootPkg.license,
        repository: rootPkg.repository,
        files: [binaryName],
        ...meta,
        publishConfig: rootPkg.publishConfig,
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(pkgDir, "README.md"),
    `# ${name}\n\nThe \`${target}\` binary for [@artemiy/oxfmt-allman](../../README.md).\n` +
      `Installed automatically as an optional dependency; do not depend on it directly.\n`,
  );

  optionalDependencies[name] = version;
  built.push(target);
}

if (built.length === 0) {
  console.error("no binaries found in artifacts/ — nothing to package");
  process.exit(1);
}

rootPkg.optionalDependencies = Object.fromEntries(Object.entries(optionalDependencies).sort());
writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);

console.log(`packaged ${built.length} target(s) at version ${version}:`);
for (const target of built) console.log(`  ${target}`);
