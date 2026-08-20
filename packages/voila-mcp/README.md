# @firfi/voila-mcp

[![npm](https://img.shields.io/npm/v/@firfi/voila-mcp)](https://www.npmjs.com/package/@firfi/voila-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

Voila MCP server for safe personal grocery search, cart, slots, and order-history workflows. The server exposes small auditable tools and does not expose checkout or order placement.

## Configuration

The server reads configuration from environment variables:

- `VOILA_AUTH_SESSION_PATH`: absolute path to an SDK session snapshot JSON file, read and written as one path.
- `VOILA_GUEST=1`: force guest-session behavior.
- `VOILA_USER_AGENT`: optional browser identity override. The built-in default works for most users.
- `VOILA_KEEPALIVE=0`: disable the background session keepalive (enabled by default).
- `VOILA_KEEPALIVE_INTERVAL_SECONDS`: keepalive interval in seconds (default `86400`, minimum `3600`).
- `MCP_TRANSPORT`: `stdio` by default, or `http`.
- `MCP_HTTP_HOST`: HTTP bind host. Defaults to `127.0.0.1`.
- `MCP_HTTP_PORT` / `PORT`: HTTP port. Defaults to `3000`.
- `MCP_HTTP_PATH`: HTTP MCP path. Defaults to `/mcp`.

If a tool runs with a guest, expired, missing, or unreadable account session, the tool result includes `authGuidance` with the CLI command to run. The MCP server does not launch a browser; run the command, log in in Chromium, close the browser window to save, then retry the MCP request. A login that lands while the server is running takes effect on the next tool call, without a restart.

Guest sessions are held in memory and never written to the session file.

The server runs a background keepalive on startup: it periodically re-checks the active session (`GET /sessions/active`), which folds rotated `Set-Cookie` values back into the stored session snapshot and keeps an idle account session warm. Voila has no refresh token, so this cannot outlast an absolute server-side expiry, but it prevents idle-timeout logout for long-lived remote agents. Keepalive is read-only and never mutates the cart; set `VOILA_KEEPALIVE=0` to turn it off. Once a session drops to re-authentication-required, keepalive logs it (to stderr) and the next tool call surfaces `authGuidance`.

## Client Example

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

## HTTP / Glama

HTTP transport is intended for registry inspection and deployments behind a trusted gateway:

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 PORT=8080 VOILA_GUEST=1 npx -y @firfi/voila-mcp
```

Requests carrying a non-local `Origin` header are refused with `403`, so a page in the user's browser cannot drive the tools through a loopback port. That is not access control: put authentication in front of `/mcp` before exposing it.

`VOILA_GUEST=1` lets Glama start the server and inspect tool definitions without a user browser session or account credentials. Do not expose HTTP with a real session file directly to the public internet; put authentication and access control in front of `/mcp`.

## Tools

- `voila_check_session_health`
- `voila_get_active_shopping_context`
- `voila_get_slot_listings`
- `voila_reserve_slot`
- `voila_search_products`
- `voila_get_category_products`
- `voila_get_discounted_products`
- `voila_get_completed_orders`
- `voila_get_order_details`
- `voila_get_completed_order_items`
- `voila_get_cart`
- `voila_add_cart_items`
- `voila_remove_cart_items`

`voila_get_active_shopping_context` and `voila_get_slot_listings` are the preferred first steps for planning an order because product pricing and availability depend on delivery context. Product-first search remains available.

`voila_reserve_slot` mutates the active session and requires explicit confirmation flags from the caller.

`voila_get_completed_orders` reads completed orders with cursor pagination. It does not expose reorder, checkout, or order placement.

`voila_get_order_details` reads item-level details for one completed order, including received, substituted, missing, returned, and at-risk item groups when Voila returns them.

`voila_get_completed_order_items` aggregates received items across completed orders, optionally filtered by `fromDate` and `toDate`, so a client can answer questions such as what the user ordered last month.

The server does not expose checkout or order-placement tools.

## Connection Compatibility

Voila can change its unofficial web endpoints and security rules at any time. The server uses a stable
browser identity by default, allows an override with `VOILA_USER_AGENT`, and reports blocked requests
without exposing private session data. See [request identity and blocking](https://github.com/dearlordylord/voila-sdk/blob/master/docs/request-identity.md)
for precedence, diagnostics, and the read-only smoke test.
