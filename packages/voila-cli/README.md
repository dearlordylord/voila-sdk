# @firfi/voila-cli

Command line interface for personal Voila grocery automation.

## Defaults

- Session file: `~/.config/voila/session.json`
- Browser profile: `~/.cache/voila/browser-profile`
- Playwright browser cache: honors `PLAYWRIGHT_BROWSERS_PATH`; use `~/.cache/ms-playwright-voila` for an isolated cache.

## Commands

```bash
voila auth login --session ~/.config/voila/session.json
voila auth status --json
voila auth keepalive --interval 86400
voila search "milk" --page-size 12
voila category products <category-id>
voila orders list --page-size 20
voila orders details <order-id>
voila orders items --from-date 2026-06-01 --to-date 2026-06-30
voila cart get
voila cart add <product-uuid> --quantity 1
voila cart remove <product-uuid> --quantity 1
```

`auth login` opens Chromium. Log in manually, then close the browser window to save. The CLI requires authenticated cookie evidence, validates the capture with Voila inside the guarded session-file cycle, and saves only the active snapshot returned by that check. An inactive or unauthorized capture leaves the existing file untouched. If another process writes a newer session during validation, the login reports `VoilaAuthSessionSuperseded` rather than writing over it.

`auth keepalive` runs a foreground loop that periodically re-checks the authenticated session snapshot (`GET /sessions/active`). Voila has no refresh token; each check folds rotated `Set-Cookie` values back into the saved session, so a running keepalive keeps an idle session warm against server-side sliding expiry. It never mutates the cart. Progress is logged to stderr; `Ctrl-C` (`SIGINT`) and `SIGTERM` cancel the loop, clean up signal listeners, and exit `0`. Expiry exits non-zero so the caller can run `voila auth login` again; a missing or guest-shaped session snapshot is a non-zero misconfiguration. Default interval is once per day; override with `--interval` (seconds, minimum 3600 / 1 hour). This is convenient as a small background service (systemd/launchd/pm2) for long-lived remote agents.

`orders list` reads completed orders with cursor pagination; pass `--page-token` from the previous response to fetch the next page.

`orders details` reads item-level details for one completed order. `orders items` aggregates received items across completed orders, with optional date filters and `--max-orders`.

Cart commands use Voila product UUIDs. The CLI does not place orders.
