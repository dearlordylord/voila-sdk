# @firfi/voila-mcp

Stdio MCP server for personal Voila grocery automation.

## Configuration

The server reads configuration from environment variables:

- `VOILA_AUTH_SESSION_PATH`: path to an SDK session snapshot JSON file.
- `VOILA_SESSION_WRITE_PATH`: optional path for updated session snapshots. Defaults to `VOILA_AUTH_SESSION_PATH`.
- `VOILA_GUEST=1`: force guest-session behavior.

If a tool runs with a guest, expired, missing, or unreadable account session, the tool result includes `authGuidance` with the CLI command to run. The MCP server does not launch a browser; run the command, log in in Chromium, close the browser window to save, then retry the MCP request.

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

## Tools

- `voila_check_session_health`
- `voila_search_products`
- `voila_get_category_products`
- `voila_get_cart`
- `voila_add_cart_items`
- `voila_remove_cart_items`

The server does not expose checkout or order-placement tools.
