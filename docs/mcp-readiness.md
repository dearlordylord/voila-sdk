# MCP Readiness

Voila includes an MCP server package: `@firfi/voila-mcp`. The server is built on `@effect/ai`'s `McpServer` over `@effect/rpc`; no `@modelcontextprotocol/*` package is a dependency.

## Package Boundary

The SDK owns Voila endpoint behavior:

- request construction
- Effect Schema response decoding
- session snapshot parsing and persistence helpers
- cookie and CSRF propagation
- search, category reads, cart reads, cart mutations, and completed order reads

The MCP package owns:

- MCP tool names and Effect Schema tool parameters
- the Node transport layer the server and the CLI run on
- session file configuration from environment variables
- guest fallback
- redacted typed failures
- persistence of updated SDK session snapshots

The CLI reuses the MCP operation registry so command behavior and tool behavior stay aligned.

## Server

- MCP server name: `io.github.dearlordylord/voila-mcp`
- Transports: stdio (default) and HTTP, selected with `MCP_TRANSPORT`
- Bin: `voila-mcp`
- Negotiated protocol version: `2025-06-18`

Environment:

- `VOILA_AUTH_SESSION_PATH`: absolute path to a session snapshot, read and written as one path.
- `VOILA_GUEST=1`: force guest behavior. Guest sessions live in memory and are never written to the session file.
- `VOILA_USER_AGENT`: optional browser identity override.
- `VOILA_KEEPALIVE=0`: disable the background authenticated-session keepalive. When unset, keepalive is enabled only when an explicit `VOILA_AUTH_SESSION_PATH` is configured and guest mode is off.
- `VOILA_KEEPALIVE_INTERVAL_SECONDS`: healthy keepalive interval in seconds (default `86400`, minimum `3600`). Invalid values fail startup.
- `MCP_TRANSPORT`: `stdio` by default, or `http`.
- `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_PORT` / `PORT` (default `3000`), `MCP_HTTP_PATH` (default `/mcp`). The HTTP transport also answers liveness on `/` and `/health`.

Client config:

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

## Keepalive lifecycle

The background keepalive checks `GET /sessions/active` inside the configured
session snapshot update cycle and persists rotated cookies. It never bootstraps
or polls a guest. If the configured session snapshot disappears or is guest-
shaped, it stops with the typed `"misconfigured"` outcome; it does not silently
report a healthy guest. Server-scope shutdown interrupts the loop and cleans up
its Effect resources. The foreground `voila auth keepalive` command treats
`SIGINT` and `SIGTERM` as cancellation, removes its signal listeners, and exits
with status `0`; expiry and misconfiguration remain non-zero outcomes.

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

Every tool states all four MCP behaviour hints: reads are `readOnlyHint: true` / `idempotentHint: true` / `destructiveHint: false`, and the mutating tools (`voila_add_cart_items`, `voila_remove_cart_items`, `voila_reserve_slot`) invert the first three. All tools are `openWorldHint: true`.

Tool parameters are Effect Schemas, published as JSON Schema on `tools/list` with `additionalProperties: false` and the refinement bounds intact. A call whose arguments violate that schema, and a call whose operation fails, both come back as a tool result with `isError: true` rather than a JSON-RPC protocol error. The `arguments` field is required by the MCP schema: a parameterless tool is called with `arguments: {}`.

Cart mutation tools return normalized SDK results including totals, limited items, unavailable data, and pricing notifications.

## Safety

The HTTP transport is stateless per POST and has no session handshake to gate on, so it refuses any request whose `Origin` header is not local; a client that sends no `Origin` (a bridge, a gateway, `curl`) is served. Put authentication and access control in front of `/mcp` before exposing it beyond the local machine.

The MCP package does not expose checkout or order placement. Any future checkout mutation must fetch the latest server summary and require explicit caller confirmation.
