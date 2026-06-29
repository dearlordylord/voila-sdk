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
voila search "milk" --page-size 12
voila category products <category-id>
voila cart get
voila cart add <product-uuid> --quantity 1
voila cart remove <product-uuid> --quantity 1
```

`auth login` opens Chromium. Log in manually, then close the browser window to save. The CLI saves after Voila session material and cookies are captured, then validates the saved session.

Cart commands use Voila product UUIDs. The CLI does not place orders.
