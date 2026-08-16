# @firfi/cas-file-store

Optimistic-concurrency (CAS) read-modify-write store for small local state files shared by several local processes.

Draft package: private to this workspace, not published.

## Why

A state file read by a long-running process and rewritten later is a blind write: any update another process made in between is silently reverted. This package owns the whole read-modify-write cycle so that shape is not expressible through its API — there is no `write` primitive.

## API

```ts
import { keep, modify, modifySchema, persist, read, retryPolicy } from "@firfi/cas-file-store"
```

- `read(path)` — current raw contents, or `undefined` when the file does not exist.
- `modify(path, f, policy?)` — fresh read, run `f` on the raw contents, compare the CAS token (the bytes as read), write back atomically only if the file is unchanged.
- `modifySchema(path, schema, f, policy?)` — same cycle with `f` over a value decoded/encoded by an Effect Schema. The CAS comparison stays on raw bytes in the core, so non-canonical serialization cannot cause phantom conflicts.

`f` receives `undefined` when the file does not exist yet — a missing file is a normal starting state, and creating it belongs inside the guarded cycle rather than in a separate blind write. It returns `persist(value)` to write, or `keep` to leave the file exactly as it is, including leaving a missing file missing.

`modify` returns an outcome union:

- `{ _tag: "saved", value }` — the update landed.
- `{ _tag: "unchanged" }` — the transform kept the file as it was.
- `{ _tag: "dropped-conflict", value }` — another process wrote first; `value` is the fresh on-disk state, ready to adopt, or `undefined` when the winner removed the file.

## Conflict policies

- `dropPolicy` (default) discards the in-flight update. Correct for regenerable, lineage-bound updates such as a keepalive rotation.
- `retryPolicy(schedule)` re-reads the fresh file and re-runs the transform, bounded by an Effect `Schedule`. Exhaustion fails with `ConflictExhausted`.

There is no merge policy: snapshots are internally consistent only within one lineage. See `docs/adr/0001-cas-file-store-conflict-policy.md`.

## Guarantees

- Writes go through a sibling temp file that is fsynced and then renamed, at owner-only permissions. A missing parent directory is created owner-only, so a first run does not have to `mkdir` its way to the guarded cycle.
- Creating a file uses `link` rather than `rename`: it refuses to clobber, so a process that loses a creation race learns it lost instead of silently overwriting the winner.
- Same-process `modify` calls on one path are serialized by a per-path semaphore; cross-process safety comes from the CAS check.
- Expected failures stay in typed Effect error channels: `CasFileStoreReadFailure`, `CasFileStoreWriteFailure`, `CasFileStoreContentsInvalid`, `ConflictExhausted`.

## Example

```ts
const outcome = yield* modifySchema(sessionPath, SessionSchema, (session) =>
  Effect.succeed(session === undefined ? persist(initialSession) : persist({ ...session, refreshedAt }))
)

if (outcome._tag === "dropped-conflict") {
  // adopt the state another process wrote instead of retrying blindly
  yield* useSession(outcome.value)
}
```
