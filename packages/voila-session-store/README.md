# @firfi/voila-session-store

The session-domain file adapter: the only way a session snapshot reaches disk.

Draft package: private to this workspace, not published.

## Why

A session snapshot read at boot and written back later is a blind write: a process that loaded the file before an interactive login silently reverts it on its next tick. The local atomic file adapter owns the mechanics of the read-modify-write cycle; this package states it in session terms, so callers work in snapshots rather than bytes and the session-specific safety rules live in one place.

## API

```ts
import { keepSessionFile, persistSession, updateSessionFile } from "@firfi/voila-session-store"
```

`updateSessionFile(path, update)` is the whole surface. There is no `save`, `write`, or `initialize` entry point beside it, so a snapshot built earlier cannot be handed over for a blind write.

The path is a `StateFilePath`, exported by this package and parsed once where the session path is configured; the session file is a state file, so it does not get a second brand of its own.

`update` receives the snapshot as it exists on disk right now — or `undefined` when the file does not exist yet — and returns either `persistSession(snapshot)` or `keepSessionFile`. It is an arbitrary effect: it may perform network I/O (folding `Set-Cookie` from a live response into the snapshot it returns) and fail with its own typed errors, which surface unchanged. The whole read-decide-write window is covered by the conflict check, not just the final write.

Outcomes:

- `{ _tag: "saved", session }` — the update landed.
- `{ _tag: "unchanged" }` — the transform kept the file as it was.
- `{ _tag: "dropped-conflict", session }` — another process wrote first; `session` is the snapshot that won, ready to adopt. A dropped update is a normal outcome, not an error: a background refresh that loses to a fresh login did its job. `session` is `undefined` only when the winner removed the file.

## Session rules

- **Creation is part of the same cycle.** A missing file is a normal starting state: the transform runs against absence and the file — and its directory, on a first run — is created owner-only, guarded by the same conflict check. Creating it separately would be a blind write by another name.
- **A guest snapshot never replaces an authenticated one.** A guest session is rebuildable with one request; an authenticated one costs an interactive browser login. The refusal surfaces as `SessionFileGuestOverwriteRefused`.
- **Dropping is the conflict behaviour.** Ordinary session writes do not choose a policy.
- **Persisting a failed session is the caller's call.** The wrapper offers `keepSessionFile` and takes no view on when to use it.

## Failures

Expected failures stay in typed Effect error channels: `SessionFileReadFailure`, `SessionFileWriteFailure`, `SessionFileContentsInvalid`, `SessionFileGuestOverwriteRefused`. Messages are fixed strings — a session file's contents are cookies and tokens, and none of them, nor the file path, appear in a message.

The persisted payload is owned by `SdkSessionSnapshotSchema` in both directions; contents on disk that do not match it surface as `SessionFileContentsInvalid`.

## Example

```ts
const outcome = yield* updateSessionFile(sessionPath, (current) =>
  current === undefined
    ? bootstrapGuestSession().pipe(Effect.map(persistSession))
    : refresh(current).pipe(Effect.map(persistSession))
)

if (outcome._tag === "dropped-conflict" && outcome.session !== undefined) {
  // adopt the fresh login instead of reverting it
  yield* useSession(outcome.session)
}
```
