# Voila Workspace

Private pnpm workspace for Voila personal grocery automation packages.

## Packages

- `packages/voila-sdk`: `@firfi/voila-sdk`, the TypeScript SDK for Voila sessions, search, categories, cart, slots, and checkout-readiness helpers.
- `packages/voila-mcp`: `@firfi/voila-mcp`, a stdio MCP server exposing small auditable tools.
- `packages/voila-cli`: `@firfi/voila-cli`, a user CLI that reuses the MCP operation registry.

The root package is private. Publishable packages live under `packages/`.

## MCP Setup

```json
{
  "mcpServers": {
    "voila": {
      "command": "npx",
      "args": ["-y", "@firfi/voila-mcp"],
      "env": {
        "VOILA_AUTH_SESSION_PATH": "/absolute/path/to/session.json"
      }
    }
  }
}
```

## CLI

```bash
voila auth login --session ~/.config/voila/session.json
voila auth status --json
voila search "milk"
voila cart get
```

The CLI default session path is `~/.config/voila/session.json`. Browser login uses a persistent Playwright profile at `~/.cache/voila/browser-profile` unless `--profile` is provided.

## Verification

```bash
pnpm check-all
pnpm package:audit
```

Live endpoint smoke tests remain opt-in. Do not run live cart mutation tests against a real account unless the test cleans up and the caller explicitly asks for it.
