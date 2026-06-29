# MCP Readiness

Voila now includes a stdio MCP server package: `@firfi/voila-mcp`.

## Package Boundary

The SDK owns Voila endpoint behavior:

- request construction
- Effect Schema response decoding
- session snapshot parsing and persistence helpers
- cookie and CSRF propagation
- search, category reads, cart reads, cart mutations, and completed order reads

The MCP package owns:

- MCP tool names and input schemas
- session file configuration from environment variables
- guest fallback
- redacted typed failures
- persistence of updated SDK session snapshots

The CLI reuses the MCP operation registry so command behavior and tool behavior stay aligned.

## Server

- MCP server name: `io.github.dearlordylord/voila-mcp`
- Transport: stdio only
- Bin: `voila-mcp`

Environment:

- `VOILA_AUTH_SESSION_PATH`: path to a session snapshot.
- `VOILA_SESSION_WRITE_PATH`: optional write path; defaults to the auth path.
- `VOILA_GUEST=1`: force guest behavior.

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

## Tools

- `voila_check_session_health`
- `voila_search_products`
- `voila_get_category_products`
- `voila_get_completed_orders`
- `voila_get_order_details`
- `voila_get_completed_order_items`
- `voila_get_cart`
- `voila_add_cart_items`
- `voila_remove_cart_items`

Cart mutation tools return normalized SDK results including totals, limited items, unavailable data, and pricing notifications.

## Safety

The MCP package does not expose checkout or order placement. Any future checkout mutation must fetch the latest server summary and require explicit caller confirmation.
