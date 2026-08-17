# CAS File Store — Ecosystem & Discoverability Research

Research conducted 2026-08-16/17 in support of [#4](https://github.com/dearlordylord/voila-sdk/issues/4)
(a reusable compare-and-swap read-modify-write file store, working name `@firfi/cas-file-store`).

Two questions: (1) does a package doing this already exist in the TS ecosystem, and if not,
would publishing one take a free niche or have to outcompete incumbents; (2) how should the
package be named, described, and tagged so developers with this problem actually find it.

## 1. Does the package already exist?

**No.** Nothing on npm covers the combination that makes the proposal load-bearing: a
closure-owned read-modify-write cycle with a byte-level CAS check, a conflict outcome union
(`saved` / `dropped-conflict`), a bounded retry policy with a typed exhaustion error, and an
atomic durable write — behind one un-bypassable call. The name `cas-file-store` is
(uninformatively) free on npm.

Nearest neighbors and why each falls short:

| Package | Monthly downloads | What it does | Gap vs. the proposal |
|---|---|---|---|
| `write-file-atomic` | ~400M | tmp+rename durable writes | write-only primitive; no RMW, no CAS |
| `atomically` | ~55M | same, plus fsync control and an in-process per-path write queue | same; its queue serializes writes only, not the read→transform→compare cycle |
| `conf` / `electron-store` | ~39M / (bundled) | whole-file JSON state stores | README: "**It does not support multiple processes writing to the same store.**" — the exact blind-overwrite shape the proposal fixes |
| `lowdb` / `steno` | ~10M | local JSON DB over a queued atomic writer | no cross-process CAS, no conflict detection |
| `proper-lockfile` | ~85M | inter-process lockfile serialization | the lockfile design, already evaluated and rejected for this use case (stale-lock failure modes) |
| `@effect/platform` FileSystem | — | Effect-native fs with typed errors | no CAS/RMW primitive; no Effect community package offers one |

Conclusion: the RMW/CAS/conflict core must be written regardless — nobody ships it. The only
sub-choice is the durable-write primitive: wrap `atomically` (trivial via `Effect.tryPromise`;
buys battle-tested edge-case handling — EMFILE/EBUSY retries, ENAMETOOLONG truncation,
mode/chown preservation) or hand-roll ~30 lines on `@effect/platform` (already in the repo's
dependency tree via `voila-cli`; zero new deps, typed errors, no second queue competing with
the package's own keyed semaphore). Wrapping removes friction but not the structural overlap:
`atomically`'s per-path queue duplicates the semaphore the package needs anyway, and neither
shortens the compare-then-rename CAS window.

## 2. Dependent usage survey (who actually uses `atomically`, and how)

Sampled 21 dependent repos (18 with real current usage) via ecosyste.ms + GitHub code search,
reading actual call sites.

- **~72% (13/18) are conf-style whole-file blind overwrites**: in-memory store, serialize
  everything, atomic write — atomicity is used for *crash durability*, never for
  *inter-process correctness*. Includes `conf` itself (`source/index.ts`), `configstore`,
  `electron-conf`, `tabby`, `gitbutler`, MCP inspector's OAuth token store.
- **Only 1/18 is unambiguously the target niche**: Automattic/studio hand-rolls
  lockfile → fresh read → merge → atomic write around a `shared.json` (OAuth token + session
  metadata) shared by its desktop app and CLI — exactly the code this package would delete.
- The bug is documented, not hypothetical: conf#146 describes the lost-update interleaving a
  CAS check would catch ("multiple processes using `conf` with the same storage location …
  **clobber each other's data**"); electron-store#48 is a user hitting it in the wild.
- Observed mitigations in the wild, all partial: hand-rolled lockfiles (studio), in-process
  per-path promise queues (MCP inspector — useless across processes), watch-and-reload
  (conf's `watch` — narrows but doesn't close the race), backup+metadata recovery
  (corruption-focused). Nobody does a content-based CAS check; the only correct cross-process
  answer anyone found was a lockfile.

**Market verdict:** the package would take a niche that currently has no occupant — it would
not and could not outcompete `atomically` (different abstraction level; `atomically`'s volume
is transitive, and the natural relationship is composition — the package's write path could
sit on it). The pitch is not "atomic writes" (owned, and mostly used for crash durability);
it's "conf/store-pattern users who grow a second process" — CLI + daemon, desktop app + CLI,
multiple instances. The observed escalation path today is blind overwrite → bug report →
hand-rolled lockfile.

## 3. Discoverability plan (npm + Google)

Grounded in npm's official search docs and the npms.io scoring API. npm search indexes
**name, description, keywords, and README text**; popularity weighs heaviest in ranking, so a
new package won't beat `atomically` on head terms like "atomic file" — the wedge is
high-intent long queries where current results are junk (verified: `compare and swap` returns
semver libs, `concurrent json` returns grunt plugins, `optimistic concurrency` returns
mongoose/redis packages). New packages take up to two weeks to appear in npm search.

### 3.1 Naming — `cas-file-store` is a weak discoverability name

- "cas" on npm is squatted three times over (Central Authentication Service, certificate
  authorities, content-addressed storage) — none of those audiences are ours.
- The most common reading of "cas file store" is *content-addressed storage* (immutable
  blobs) — the opposite of what the package does. The name actively misleads.
- Nobody with this problem types "cas"; they type "compare and swap", "atomic file",
  "concurrent json", "multi-process config". The name is the strongest single search field.

Ranked candidates (availability verified against the registry, 2026-08-17):

1. **`atomic-file-store`** (unscoped, free) — recommended. Tokens match the highest-volume
   adjacent queries; reads as a *store* (RMW semantics), not a write-only primitive. Honest.
2. **`concurrent-json-store`** (free) — differentiator-first; the `concurrent json` query
   currently returns junk, ownable on day one. Slight downside: presumes JSON while the core
   is byte/string-level (mitigate in the description).
3. **`optimistic-json-store`** (free) — names the exact technique; high intent, known to
   database/ORM developers.
4. `@firfi/cas-file-store` (scoped) — only if brand consistency outweighs search traffic.
   Note: scoped-only leaves the unscoped twin registerable by anyone; don't publish
   placeholder stubs (against npm policy), and don't count on name disputes.

Avoid `atomic-json-store` and near-variants — it's a taken dead package; collision invites
confusion and a denied dispute claim.

### 3.2 Description (npm `description` + GitHub description, ≤140 chars, identical everywhere)

Recommended (133 chars):

> Atomic read-modify-write for local JSON files. Compare-and-swap optimistic concurrency across processes — no lockfiles, no merges.

Alternatives: lead with the use case ("Concurrent JSON file store with atomic
compare-and-swap updates. Safe for multiple local processes: CLIs, MCP servers, daemons.") or
with the technique for the DB-minded searcher ("Optimistic concurrency for local files:
read-modify-write with byte-level compare-and-swap, atomic rename, bounded retry.").

### 3.3 npm `keywords`

Nobody owns the compare-and-swap/optimistic-concurrency cluster for files today
(only `gitomic`, 9 dl/wk, uses those tags). Hyphens tokenize, so `compare-and-swap` also
matches the query "compare and swap":

```json
["atomic", "read-modify-write", "compare-and-swap", "optimistic-concurrency",
 "concurrent", "multi-process", "cross-process", "race-condition",
 "json", "json-file", "file", "store", "config", "session",
 "atomic-write", "effect", "typescript"]
```

Deliberately excluded: `cas` (wrong-audience neighborhood), `lockfile` (ranking for the
anti-pattern you replace reads as poaching), and competitor names (`conf`, `lowdb`,
`electron-store`) — those belong in a README comparison section, which npm indexes anyway.

High-value phrases harvested from users' own words (issue threads/docs) for README prose and
keywords: "multiple processes writing to the same store/config file", "clobber each other's
data", "multiple instances", "config file locking", "lost update".

### 3.4 GitHub

- Repo name matches the package name exactly (GitHub↔npm parity helps Google associate them).
- Description: the npm description string, verbatim.
- Topics (own discovery surface; `github.com/topics/<topic>` pages rank on Google):
  `atomic-write`, `compare-and-swap`, `optimistic-concurrency`, `read-modify-write`,
  `concurrency`, `multi-process`, `race-condition`, `json`, `json-file`, `config-store`,
  `file-storage`, `session-storage`, `nodejs`, `typescript`, `effect`, `mcp-server`.
  `optimistic-concurrency` and `compare-and-swap` topic pages exist but are thinly populated —
  becoming the top TS repo there is plausible.

### 3.5 README opening (feeds npm page + Google snippet)

```markdown
# atomic-file-store

> Atomic read-modify-write for local JSON files. Compare-and-swap optimistic
  concurrency across processes — no lockfiles, no merges.

Your CLI writes a session file. Your MCP server refreshes it. Your keepalive
daemon touches it too. Plain read + write loses updates. `conf`, `lowdb` and
`electron-store` explicitly don't support multiple processes writing the same
file; `proper-lockfile` serializes with lockfiles. This package takes the
database approach instead: optimistic concurrency.

[canonical one-call update snippet showing the outcome union]

## When to use / when not
Small local state files shared by a few local processes. Not cross-machine,
not big files, no merge — conflicts are reported, not resolved.
```

Follow with an honest "Compared to" table (vs. `atomically`, `write-file-atomic`, `conf`,
`lowdb`, `proper-lockfile`) — named-comparison content answers "X alternative" queries
legitimately on both npm and Google.

## 4. Open positioning question

The issue's "no Promise core — both known consumers are Effect shops" is right for the
monorepo draft, but publishing changes the calculus: an Effect-only API caps the addressable
audience at the Effect community. If adoption becomes a goal, a tiny Promise core with an
Effect facade is the single highest-leverage broadening change. This research is
API-shape-agnostic; the naming/discoverability plan holds either way (drop the `effect`
keyword/topic if a Promise core ships first).
