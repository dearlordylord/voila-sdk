# Request Identity And Blocking

Voila does not publish the customer endpoints used by this project. Those endpoints and Voila's edge
security policy may change without notice, so a request identity that works today may be rejected later.

## User-Agent Precedence

The MCP server chooses one user-agent for each Voila request in this order:

1. An explicit `User-Agent` already present on the request.
2. The non-empty `VOILA_USER_AGENT` environment setting.
3. The first entry in the bundled desktop user-agent dataset.

The default is stable for a given installed dependency version. The SDK does not rotate identities, retry
around blocks, or otherwise attempt to bypass Voila's controls.

## Blocked Requests

The SDK reports `VoilaRequestBlocked` only when a response has both a known WAF status (403 or 503) and the
observed blocked-response signature. The error includes the request method, status, and an optional edge
request ID. It excludes URLs, response bodies, cookies, tokens, and credential headers.

Other 403 responses remain `VoilaUnauthorizedSession`, and other non-success responses remain
`VoilaNon2xxResponse`.

## Read-Only Smoke Test

The opt-in smoke test sends one live guest homepage request and verifies that the default identity was
sent. It then checks blocked-response diagnostics against sanitized guest-session fixture data. It does
not add cart items, reserve a slot, or touch checkout.

```bash
VOILA_WAF_SMOKE=1 pnpm smoke:request-identity
```

The live request reports only its success or status. The sanitized diagnostic check verifies the safe
`VoilaRequestBlocked` fields without deliberately provoking Voila's WAF.
