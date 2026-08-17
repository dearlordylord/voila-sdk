# Migration Plan: replace `@firfi/cas-file-store` with `atomic-file-store@^0.2.0`

Tracking issue: `dearlordylord/voila-sdk#16` (epic). Original design rationale:
`dearlordylord/voila-sdk#4`. Upstream package repo:
`dearlordylord/atomic-file-store` (`atomic-file-store#1` shipped the 0.2.0
Effect-native API this plan depends on).

## Goal

Delete the private `packages/cas-file-store` package and consume the identical
functionality from the published npm package `atomic-file-store` via its
`atomic-file-store/effect` subpath. One implementation of the CAS
read-modify-write store, maintained in the open.

## Prerequisite (blocking)

`atomic-file-store@0.2.0` must be **published on npm**. The 0.1.x line is not
sufficient: its `./effect` facade only offers a synchronous
`(string) => string` transform, while voila's session cycle performs network
I/O inside the conflict-checked window (`packages/voila-mcp/src/node-env.ts`,
`runWithSessionFile`). Check with `npm view atomic-file-store version` — must
print `0.2.0` or later. If it does not, stop: the maintainer publishes
manually.

## Why this is a rename, not a rewrite

`atomic-file-store@0.2.0`'s `./effect` subpath was ported from
`packages/cas-file-store` at master with feature parity, including its test
suites. The migration is: point imports at the npm package, rename the error
types/tags, delete the local package, clean up wiring. No behavior changes.

## API mapping (old → new)

Everything below comes from `@firfi/cas-file-store` today and from
`atomic-file-store/effect` after. Names are identical unless listed:

| `@firfi/cas-file-store` | `atomic-file-store/effect` |
|---|---|
| `modify`, `modifySchema`, `modifySchemaCarrying`, `read` | same names |
| `keep`, `persist`, `WriteDecision`, `ModifyOutcome`, `SchemaCycleStep`, `CarriedModifyOutcome` | same names |
| `ConflictPolicy`, `dropPolicy`, `retryPolicy` | same names |
| `makeStateFileLocks`, `StateFileLocks`, `StateFileLocksService`, `StateFileLocksLive`, `stateFileLocksLayer` | same names |
| `StateFilePath`, `StateFilePathSchema`, `parseStateFilePath` | same names |
| `CasFileStoreReadFailure` (interface) | `ReadError` (**class**, `_tag: "ReadError"`) |
| `CasFileStoreWriteFailure` (interface) | `WriteError` (**class**, `_tag: "WriteError"`) |
| `CasFileStoreContentsInvalid` (interface) | `ContentsInvalidError` (**class**, `_tag: "ContentsInvalidError"`) |
| `CasFileStoreAbsent` | `AbsentError` (class; only the bare `read` fails this way — session-store does not use `read`) |
| `CasFileStorePathInvalid` | `PathInvalidError` (class, no path payload) |
| `ConflictExhausted` | same name, now a **class** extending `Error`, `_tag` unchanged |
| `CasFileStoreError` (union type) | **no union exported** — define locally: `ReadError \| WriteError \| ContentsInvalidError` |

All new errors extend `Error` and carry a readonly `_tag`, so `_tag`-keyed
dispatch still works. Messages name the path but never file contents —
voila's session-file error layer already re-wraps everything into
fixed-string session errors, so this changes nothing observable.

## Consumers (complete list, verified by repo-wide grep)

Only `@firfi/voila-session-store` imports `@firfi/cas-file-store`. Nothing
else may change behavior; mcp/cli consume the store purely through
session-store re-exports.

- `packages/voila-session-store/src/session-file-store.ts` — imports
  `CarriedModifyOutcome`, `keep`, `modifySchemaCarrying`, `persist`,
  `SchemaCycleStep`, `StateFileLocks`, `StateFilePath`, `WriteDecision`.
- `packages/voila-session-store/src/session-file-errors.ts` — imports types
  `CasFileStoreError`, `ConflictExhausted`; maps `_tag` strings.
- `packages/voila-session-store/src/index.ts` — re-exports `StateFilePath`,
  `StateFilePathSchema`, `makeStateFileLocks`, `StateFileLocks`,
  `StateFileLocksService`, `StateFileLocksLive`.
- `packages/voila-session-store/test/session-file-store.test.ts:11` — imports
  `StateFilePath`, `StateFilePathSchema` from `@firfi/cas-file-store` directly.
- Downstream users of the re-exports (must stay untouched):
  `packages/voila-mcp/src/node-env.ts` (`makeStateFileLocks`),
  `packages/voila-mcp/test/operations.test.ts` (`StateFilePathSchema.make`),
  `packages/voila-cli/src/auth-login.ts` (`makeStateFileLocks`),
  `packages/voila-cli/src/auth-session-file.ts`,
  `packages/voila-cli/test/auth-session-file.test.ts`.

## Step-by-step

### 1. Verify the prerequisite

```bash
npm view atomic-file-store version   # must be >= 0.2.0
```

### 2. Swap the dependency in `voila-session-store`

`packages/voila-session-store/package.json`:

- Remove `"@firfi/cas-file-store": "workspace:*"`.
- Add `"atomic-file-store": "^0.2.0"` to `dependencies` (keep `effect` — the
  subpath lists `effect` as an optional peer, and voila already depends on it).
- Update the `description` field: "Session-domain wrapper over
  `atomic-file-store`: the only way a session snapshot reaches disk".

### 3. Repoint the three source files

- `src/session-file-store.ts`: change the import source to
  `atomic-file-store/effect`. No symbol renames needed in this file.
- `src/index.ts`: change both re-export sources to
  `atomic-file-store/effect`. Same symbols.
- `src/session-file-errors.ts`:
  - Import `ConflictExhausted`, `ContentsInvalidError`, `ReadError`,
    `WriteError` from `atomic-file-store/effect`.
  - Replace `CasFileStoreError` with a local union:
    `type StoreError = ReadError | WriteError | ContentsInvalidError`.
  - Retarget the `_tag` map keys: `CasFileStoreContentsInvalid` →
    `ContentsInvalidError`, `CasFileStoreReadFailure` → `ReadError`,
    `CasFileStoreWriteFailure` → `WriteError`. `ConflictExhausted` and
    `SessionFileGuestOverwriteRefused` keys stay.
  - Keep the doc comment's intent; update wording that says "the store's"
    types are interfaces — they are classes now.
- `test/session-file-store.test.ts:11`: import `StateFilePath`,
  `StateFilePathSchema` from `atomic-file-store/effect` (or from
  `@firfi/voila-session-store` — prefer the package under test).

Do **not** touch `voila-mcp` or `voila-cli` sources. If typecheck forces a
change there, the re-export surface drifted — fix session-store instead.

### 4. Delete `packages/cas-file-store`

Remove the whole directory: `src/`, `test/` (ported upstream), `README.md`,
`package.json`, `tsconfig.json`.

### 5. Clean up workspace wiring

- Root `tsconfig.json`: remove the `./packages/cas-file-store` reference.
- `tsconfig.base.json`: remove the `@firfi/cas-file-store` `paths` alias.
- `vitest.config.ts`: remove the `@firfi/cas-file-store` resolve alias.
- `packages/voila-session-store/tsconfig.json`: remove the `../cas-file-store`
  project reference.
- `pnpm install` to regenerate `pnpm-lock.yaml` (workspace glob `packages/*`
  picks up the deletion automatically; no `pnpm-workspace.yaml` edit needed).
- `coverage/coverage-summary.json` is generated output — do not hand-edit.

### 6. Docs

- `CLAUDE.md` line 23: delete the `packages/cas-file-store` bullet in "Private
  draft packages".
- `packages/voila-session-store/README.md`: replace `@firfi/cas-file-store`
  mentions with `atomic-file-store` (npm link), keeping the session-domain
  framing.
- ADRs `docs/adr/0001-cas-file-store-conflict-policy.md` and
  `0002-session-file-store-write-path.md`: keep as history. Add a one-line
  note at the top of 0001: "Superseded: the store now lives as
  `atomic-file-store` (npm); this ADR records the original decision."
- `plans/effect-native-transport-and-mcp-plan.md`: historical, leave it.

### 7. Verify

```bash
pnpm install
pnpm check-all        # build + typecheck + circular + lint + fixture audit + coverage
pnpm package:audit
grep -r "cas-file-store" --include="*.ts" --include="*.json" --include="*.md" . \
  | grep -v node_modules | grep -v dist
# expected hits only in: docs/adr/0001 (file name + history), docs/adr/0002,
# plans/effect-native-transport-and-mcp-plan.md, this plan
```

The parity proof is the existing suite:
`packages/voila-session-store/test/session-file-store.test.ts` covers
creation-inside-the-cycle, guest-overwrite refusal, conflict outcomes, and
carried values — all unchanged semantics. It must pass unmodified except for
the import line in step 3.

## Acceptance criteria

- [ ] `atomic-file-store@^0.2.0` is a dependency of `@firfi/voila-session-store`
- [ ] `packages/cas-file-store/` deleted; no `cas-file-store` references
      outside ADR/plan history
- [ ] `voila-session-store` public API unchanged (mcp/cli untouched)
- [ ] `pnpm check-all` and `pnpm package:audit` green

## Risks and notes

- **Resolution mode**: repo tsconfig uses `moduleResolution: NodeNext` with
  `verbatimModuleSyntax`. `atomic-file-store` declares an `./effect` export
  with `types`/`import` conditions, so `atomic-file-store/effect` resolves
  without any `paths` alias. If typecheck cannot find the subpath, confirm the
  installed version is really 0.2.0 before adding any alias.
- **esbuild bundling**: mcp/cli bundle session-store at build time, so
  `atomic-file-store` code gets inlined into their artifacts. Its
  Promise-entry zero-dependency claim is irrelevant here — the Effect subpath
  is what ships, and `effect` is already in the graph.
- **Error classes crossing the bundle boundary**: instanceof checks against
  duplicated `atomic-file-store` copies would be unreliable, but nothing in
  voila uses instanceof on these errors — dispatch is by `_tag`, which is a
  string. Safe.
- **No version bump needed**: all voila packages consuming the store are
  private/bundled; published artifacts (`voila-mcp`, `voila-cli`) change
  contents but not their dependency graphs.
