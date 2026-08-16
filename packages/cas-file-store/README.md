# @firfi/cas-file-store

Optimistic-concurrency (CAS) read-modify-write store for small local state files shared by several local processes.

Draft package: private to this workspace, not published.

## Why

A state file read by a long-running process and rewritten later is a blind write: any update another process made in between is silently reverted. This package owns the whole read-modify-write cycle so that shape is not expressible through its API — there is no `write` primitive.

## API

```ts
import { modify, modifySchema, read, retryPolicy } from "@firfi/cas-file-store"
```

- `read(path)` — current raw contents.
- `modify(path, f, policy?)` — fresh read, run `f` on the raw contents, compare the CAS token (the bytes as read), write back atomically only if the file is unchanged.
- `modifySchema(path, schema, f, policy?)` — same cycle with `f` over a value decoded/encoded by an Effect Schema. The CAS comparison stays on raw bytes in the core, so non-canonical serialization cannot cause phantom conflicts.

`modify` returns an outcome union:

- `{ _tag: "saved", value }` — the update landed.
- `{ _tag: "dropped-conflict", value }` — another process wrote first; `value` is the fresh on-disk state, ready to adopt.

## Conflict policies

- `dropPolicy` (default) discards the in-flight update. Correct for regenerable, lineage-bound updates such as a keepalive rotation.
- `retryPolicy(schedule)` re-reads the fresh file and re-runs the transform, bounded by an Effect `Schedule`. Exhaustion fails with `ConflictExhausted`.

There is no merge policy: snapshots are internally consistent only within one lineage. See `docs/adr/0001-cas-file-store-conflict-policy.md`.

## Guarantees

- Writes go through a sibling temp file that is fsynced and then renamed, at owner-only permissions.
- Same-process `modify` calls on one path are serialized by a per-path semaphore; cross-process safety comes from the CAS check.
- Expected failures stay in typed Effect error channels: `CasFileStoreReadFailure`, `CasFileStoreWriteFailure`, `CasFileStoreContentsInvalid`, `ConflictExhausted`.

## Example

```ts
const outcome = yield* modifySchema(sessionPath, SessionSchema, (session) =>
  Effect.succeed({ ...session, refreshedAt })
)

if (outcome._tag === "dropped-conflict") {
  // adopt the state another process wrote instead of retrying blindly
  yield* useSession(outcome.value)
}
```
