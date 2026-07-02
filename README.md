# Voila MCP

[![npm](https://img.shields.io/npm/v/@firfi/voila-mcp)](https://www.npmjs.com/package/@firfi/voila-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@firfi/voila-mcp)](https://www.npmjs.com/package/@firfi/voila-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Glama score](https://glama.ai/mcp/servers/@dearlordylord/voila-sdk/badges/score.svg)](https://glama.ai/mcp/servers/@dearlordylord/voila-sdk)

**Voila MCP** is a Model Context Protocol server for safe personal Voila grocery automation. It exposes small, auditable tools for product search, category browsing, discounts, delivery slots, cart deltas, and completed order history without exposing checkout or order placement.

Published on npm as [`@firfi/voila-mcp`](https://www.npmjs.com/package/@firfi/voila-mcp). The repository also includes [`@firfi/voila-sdk`](https://www.npmjs.com/package/@firfi/voila-sdk) and [`@firfi/voila-cli`](https://www.npmjs.com/package/@firfi/voila-cli).

## Packages

- `packages/voila-sdk`: `@firfi/voila-sdk`, the TypeScript SDK for Voila sessions, search, categories, cart, order history, slots, and checkout-readiness helpers.
- `packages/voila-mcp`: `@firfi/voila-mcp`, a stdio MCP server exposing small auditable tools.
- `packages/voila-cli`: `@firfi/voila-cli`, a user CLI that reuses the MCP operation registry.

The root package is private. Publishable packages live under `packages/`.

## MCP Setup

Voila does not publish a documented third-party customer API. This server uses the same same-origin JSON endpoints as the web app, so authenticated use is session-based. Capture a session interactively with the CLI; do not store a Voila password in MCP config.

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

If the session is missing, expired, or guest-only, tool results include `authGuidance` with the exact CLI login command to run. The MCP server itself does not launch a browser.

## Tools

- `voila_check_session_health`: report active, guest, expired, or retryable session state.
- `voila_get_active_shopping_context`: read current region, destination, delivery method, and cart context.
- `voila_get_slot_listings`: list delivery slots for an explicit destination and region.
- `voila_reserve_slot`: reserve a caller-selected slot only with explicit confirmation flags.
- `voila_search_products`: search products for the current session context.
- `voila_get_category_products`: fetch products for a Voila category id.
- `voila_get_discounted_products`: scan promotions and return meaningful discounted products.
- `voila_get_completed_orders`: read completed orders with cursor pagination.
- `voila_get_order_details`: read item-level details for one completed order.
- `voila_get_completed_order_items`: aggregate previously ordered items across completed orders.
- `voila_get_cart`: read active cart totals, limited items, unavailable data, and pricing notices.
- `voila_add_cart_items`: add quantity deltas using Voila product UUIDs.
- `voila_remove_cart_items`: remove quantity deltas using Voila product UUIDs.

The server does not expose checkout or order-placement tools. Cart mutations use quantity deltas and return server notices for limited, unavailable, and pricing-change cases.

## Transports

Stdio is the default for local MCP clients:

```bash
npx -y @firfi/voila-mcp
```

HTTP is available for registry inspection and deployments behind a trusted gateway:

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 PORT=8080 VOILA_GUEST=1 npx -y @firfi/voila-mcp
```

The HTTP endpoint is `/mcp` unless `MCP_HTTP_PATH` is set. `VOILA_GUEST=1` forces guest-session behavior for safe introspection environments such as Glama. Do not expose HTTP with a real session file directly to the public internet; put authentication and access control in front of `/mcp`.

## CLI

```bash
voila auth login --session ~/.config/voila/session.json
voila auth status --json
voila search "milk"
voila orders list
voila orders details <order-id>
voila orders items --from-date 2026-06-01 --to-date 2026-06-30
voila cart get
```

The CLI default session path is `~/.config/voila/session.json`. Browser login uses a persistent Playwright profile at `~/.cache/voila/browser-profile` unless `--profile` is provided; log in manually and close the browser window to save.

## Verification

```bash
pnpm check-all
pnpm package:audit
```

Live endpoint smoke tests remain opt-in. Do not run live cart mutation tests against a real account unless the test cleans up and the caller explicitly asks for it.
