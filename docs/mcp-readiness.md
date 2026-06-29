# MCP Readiness

The current repository is library-first. A future MCP server should reuse the SDK package surface instead of duplicating Voila endpoint logic.

## Current Boundary

The SDK owns:

- Voila request construction.
- Effect Schema response decoding.
- Session snapshot parsing and persistence helpers.
- Cookie and CSRF propagation.
- Product search, category reads, cart reads, cart mutations, delivery context, slots, and checkout review.
- Safety decisions that are domain-level, such as checkout readiness.

The future MCP layer should own:

- Tool names and tool input/output schemas.
- User-facing confirmation prompts.
- Session file configuration.
- Redacted diagnostics.
- Policy around which SDK calls are exposed as read-only, mutation, or confirmation-required tools.

## Recommended Shape

Keep the npm SDK entrypoint stable:

```ts
import { searchProducts, addCartItems, getCart } from "@firfi/voila-sdk"
```

Add MCP as one of these later:

- a second workspace package such as `@firfi/voila-mcp`, or
- a package subpath/bin added deliberately, such as `@firfi/voila-sdk/mcp` plus a `bin` entry.

Do not make the current root export depend on MCP runtime libraries. The SDK should remain usable as a small library dependency for scripts and tests.

## Tool Safety Defaults

Future MCP tools should start with these categories:

- Read-only: search, category products, cart read, session health, delivery destinations, slot listing, checkout summary.
- Mutation with explicit tool name: add cart item, remove cart item, apply delivery context change.
- Confirmation-required: slot reservation.
- Out of scope: order placement.

Any tool that mutates cart or delivery state should return the server result, totals, warnings, unavailable data, and enough context for a human or agent to verify the effect.

## Release Impact

When MCP is added, update:

- `package.json` exports/bin/files.
- `scripts/audit-package.mjs` tarball expectations.
- `docs/public-api.md`.
- `README.md`.
- release checklist in `docs/release.md`.

Keep `pnpm release:check` as the required publish gate.
