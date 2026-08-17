# CAS file store: drop-on-conflict beats lockfiles and retry-by-default

Superseded by [`atomic-file-store`](https://www.npmjs.com/package/atomic-file-store) (npm).

`@firfi/cas-file-store` (draft package, `packages/cas-file-store`) guards read-modify-write cycles of small local JSON state files shared by multiple processes (the session snapshot is the motivating case — a background keepalive once reverted fresh logins by blindly overwriting them). The store owns the whole cycle inside one `modify(path, f)` call: fresh read, transform, compare the CAS token (raw bytes), atomic tmp+rename write only if unchanged. On conflict the default policy is **drop**: the in-flight update is discarded and the on-disk value stands.

Considered and rejected:

- **Lockfile serialization** — stronger guarantee, but crash leaves stale locks requiring TTL heuristics, and it only works if every writer participates. Not worth it for a single-user tool where the residual CAS race window is milliseconds.
- **Optimistic retry as default** — available as an opt-in policy (`retry` with an Effect `Schedule`), but a poor default: it repeats the slow remote call the keepalive exists to minimize, to win a write the next scheduled tick gets for free.
- **Merging on conflict** — never: snapshots are only internally consistent within one lineage; merging across lineages produces broken states.
- **SQLite or a daemon** — rejected as overengineering for one-row, few-KB state; see the spec issue for the full evaluation.

Entry points take a parsed, absolute `StateFilePath` rather than a string, so a relative path cannot mean two different files in two processes. A missing file is part of the same cycle: the transform runs against absence and the file is created with an exclusive `link`, which refuses to clobber, so a lost creation race surfaces as an ordinary conflict.

Consequences: the package core is byte/string-level by design — Schema-aware decoding lives in a thin `modifySchema` wrapper so the CAS token stays raw bytes and the core carries no serialization coupling. A keyed in-process semaphore serializes same-process `modify` calls per path; cross-process safety comes from the CAS check alone. Writes fsync the temp file before rename.
