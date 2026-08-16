# PROTOTYPE — throwaway, do not merge to master

This branch preserves the throwaway prototype that settled the conflict-policy
design for `@firfi/cas-file-store` (see the spec issue and
`docs/adr/0001-cas-file-store-conflict-policy.md`).

## Question it answered

Which conflict policy should guard read-modify-write cycles of the shared
session file: status-quo blind write, CAS drop, optimistic retry, or lockfile
serialization?

## What it is

`store.ts` implements all four variants against a real filesystem; the tests
drive them with Effect `TestClock`, so "the keepalive reverts your login every
day for a week" runs in milliseconds.

## Verdict (validated by the tests)

- Status quo reverts a concurrent login — and keeps reverting every login until
  the process restarts (the PR #3 bug, reproduced).
- CAS drop preserves the login and adopts its lineage on the next tick. Chosen.
- Optimistic retry converges but doubles the HTTP calls — rejected as default,
  kept as an opt-in policy.
- Lockfile serializes cleanly and survives interruption, but adds stale-lock
  failure modes — rejected for a single-user tool.

## Run it

```bash
ln -s <repo>/node_modules prototypes/cas-file-store/node_modules
<repo>/node_modules/.bin/vitest run --root prototypes/cas-file-store
```
