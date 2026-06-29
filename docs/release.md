# Release

Use this checklist before publishing `@firfi/voila-sdk` to npm.

## Preconditions

- `package.json` has the intended version.
- `README.md` describes the current public API, safety model, live smoke flags, and auth capture flow.
- `docs/public-api.md` matches the exported package surface.
- No local session snapshots, browser profiles, fixture refresh scratch files, or generated coverage reports are staged.
- Live endpoint drift was either checked or intentionally deferred with a reason.

## Required Gate

```bash
pnpm release:check
```

This runs:

- `pnpm check-all`
- `pnpm package:audit`

`pnpm package:audit` builds the SDK and verifies the `npm pack --dry-run` file list.

## Optional Live Checks

Default release checks do not hit Voila. Run these only when you want live confidence:

```bash
VOILA_LIVE_SMOKE=1 pnpm smoke:catalog-search
VOILA_LIVE_SMOKE=1 pnpm smoke:cart
VOILA_AUTH_SMOKE=1 VOILA_AUTH_SESSION_PATH=/absolute/path/to/sdk-session.json pnpm smoke:auth-readonly
VOILA_DRIFT_AUDIT=1 pnpm drift:audit
```

The authenticated smoke is read-only. Do not run authenticated mutation checks unless the caller explicitly asks for them.

## Publish

```bash
npm publish
```

The package is scoped and `publishConfig.access` is public. `prepublishOnly` runs `pnpm release:check`.

## Tarball Contract

The npm tarball intentionally includes only:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/src/**`

It must not include source TypeScript, tests, local sessions, browser profiles, fixtures outside compiled declarations, coverage output, or TypeScript build metadata.

## Rollback

If a bad version is published, prefer a new patch release that fixes the issue. Avoid unpublish flows unless the version contains secrets or legally sensitive material.
