# Authenticated Read-Only Smoke

The authenticated smoke test loads a caller-provided SDK session snapshot, checks session health, searches `milk`, and reads the active cart. It does not add, remove, reserve, checkout, or write the snapshot back to disk.

Run it only with an explicitly captured authenticated snapshot:

```bash
VOILA_AUTH_SMOKE=1 VOILA_AUTH_SESSION_PATH=/absolute/path/to/sdk-session.json pnpm smoke:auth-readonly
```

The snapshot path must point to JSON produced by `saveSdkSessionSnapshot`. Keep it outside the repository, or use a path under `local-session-snapshots/`, which is ignored by git.

If `VOILA_AUTH_SMOKE=1` or `VOILA_AUTH_SESSION_PATH` is missing, the script exits successfully and prints a skip message. Runtime failures are typed and redacted; the script prints failure tags, not cookies, CSRF tokens, addresses, account identifiers, or the snapshot path.

Create or refresh the snapshot with the interactive browser login flow in [browser-login.md](./browser-login.md). Re-run login when the smoke reports `AuthReadOnlySmokeSessionNotActive` with `reauth-required` or `unauthorized`.
