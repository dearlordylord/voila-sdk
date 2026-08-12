# Release

Use this checklist before publishing public packages from `master`.

## Packages

- `@firfi/voila-sdk`
- `@firfi/voila-mcp`
- `@firfi/voila-cli`

The root `voila-workspace` package is private.

## Required Gate

```bash
pnpm release:check
```

This runs build, typecheck, circular dependency detection, lint plus duplication checks, fixture audit, coverage, and per-package tarball audits.

## Optional Live Checks

Default release checks do not hit Voila. Run these only when you want live confidence:

```bash
VOILA_LIVE_SMOKE=1 pnpm smoke:catalog-search
VOILA_LIVE_SMOKE=1 pnpm smoke:cart
VOILA_AUTH_SMOKE=1 VOILA_AUTH_SESSION_PATH=/absolute/path/to/sdk-session.json pnpm smoke:auth-readonly
VOILA_DRIFT_AUDIT=1 pnpm drift:audit
```

The authenticated smoke is read-only. Do not run authenticated mutation checks unless the caller explicitly asks for them.

## Local Publish Dry Run

```bash
pnpm release:local
```

This runs the full release gate and then performs recursive npm publish dry runs for public workspace packages.

## Tarball Contracts

SDK tarball:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/src/**`

MCP and CLI tarballs:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/index.cjs`
- `dist/index.mjs`
- `dist/bin.cjs`
- `dist/types/**/*.d.ts`
- `dist/types/**/*.d.ts.map`

Tarballs must not include source TypeScript, tests, local sessions, browser profiles, coverage output, or TypeScript build metadata.

## Prepare a Release

Before handing publication to the npm-authenticated host:

1. Bump every changed publishable package and synchronize `server.json`.
2. Run `pnpm release:check` in the development container.
3. Commit and push the prepared release to `master`.

The development container owns native tooling installation and the full quality gate. Do not make the host publish command reinstall or rebuild workspace tooling.

## Publish

From the clean, prepared `master` worktree on the npm-authenticated host, run exactly:

```bash
pnpm release:publish
```

This command does not install dependencies, rebuild package artifacts or native tooling, or repeat the full development quality gate. It refuses a dirty worktree, verifies MCP registry metadata and schema, publishes only package versions not already present on npm, and then creates and pushes the MCP release tag. It publishes the artifacts already built and audited by the preparation gate with package lifecycle scripts disabled.
