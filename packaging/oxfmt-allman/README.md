# @artemiy/oxfmt-allman

A fork of [oxfmt](https://oxc.rs/docs/guide/usage/formatter) that adds a `braceStyle` option.
Built on upstream oxfmt 0.60.0; everything else behaves exactly like it.

## Install

```sh
npm i -D @artemiy/oxfmt-allman
```

## Use

Add `braceStyle` to `.oxfmtrc.json`:

```json
{
  "braceStyle": "allman"
}
```

| Value | Effect |
| --- | --- |
| `"1tbs"` (default) | Upstream/Prettier behaviour. `} else {` on one line. |
| `"stroustrup"` | Opening brace stays put, but `else` / `catch` / `finally` / `while` start a new line. |
| `"allman"` | Every opening brace goes on a line of its own. |

```sh
npx oxfmt src
```

### What `allman` covers

`if` / `else if` / `else`, `for`, `while`, `do…while`, `try` / `catch` / `finally`, `switch` and
blocks inside `case`, functions, methods, arrow functions, classes, `static {}`, `interface`,
`enum`, `namespace`, standalone blocks — plus object literals and type literals.

Object and type literals only move the brace **when they break**. Something that fits on one line
stays inline, so `const a = { x: 1 };` is left alone rather than exploded into three lines.

```ts
const config =
{
  retries: 3,
  onDone()
  {
    return true;
  },
};
```

### Where the brace deliberately stays put

After `return`, `throw` and `yield`, because a line break there would be swallowed by automatic
semicolon insertion and silently change what the code does:

```js
// stays on one line — `return\n{` would return undefined
return { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5, zeta: 6, eta: 777 };
```

This also covers the cases where the literal merely *starts* the expression, such as
`return { ...a }.value` or `return { ...a } as T`.

## Limitations of this build

This packages the **pure-Rust CLI** (`cargo build -p oxfmt --no-default-features`), not the
Node/NAPI hybrid that upstream ships on npm. Compared to upstream `oxfmt`:

- Formats `.js` `.jsx` `.ts` `.tsx` `.json` `.jsonc` `.css` `.scss` `.less` `.graphql` `.toml`
- Silently skips `.vue`, `.svelte`, `.md`, `.html`, `.yaml` — those need Prettier delegation
- No stdin support, no LSP, no Node API
- No embedded-language formatting (css-in-js, gql-in-js, html-in-js)

`braceStyle` only affects JS/TS/JSX/TSX.

## Platforms

One package ships every binary and picks the right one at runtime:

| OS | x64 | arm64 |
| --- | --- | --- |
| Linux (glibc) | yes | yes |
| Linux (musl / Alpine) | yes | yes |
| macOS | yes | yes |
| Windows | yes | yes |

Works in Docker on Ubuntu, Debian and Alpine with no extra setup.

### Why a single package

esbuild, swc and upstream oxfmt split binaries into per-platform packages behind
`optionalDependencies`, so npm downloads only the one it needs. That does not work on a GitLab
npm registry: GitLab serves a minimal packument containing only `bin`, `dist`, `engines`, `name`
and `version`. `optionalDependencies`, `os` and `cpu` are dropped, and since npm resolves
dependencies from the packument rather than from the tarball, it never learns the platform
packages exist — you end up with a shim and no binary. Verified against GitLab 17.9.

The cost is download size: roughly 20 MB compressed, 44 MB on disk. To trim it, delete the
targets you do not need from `binaries/` before publishing.

## Upstream

Based on oxc-project/oxc. `braceStyle` is not an upstream feature; see
[oxc-project/oxc#20154](https://github.com/oxc-project/oxc/issues/20154).
