# Voila SDK

TypeScript SDK for Voila grocery search, session handling, and cart workflows.

This package wraps the same same-origin JSON endpoints used by the Voila web app. Voila does not publish a third-party customer API, so the SDK treats every live response as an unstable boundary: all I/O payloads are parsed with Effect Schema, failures are typed, and order placement is intentionally out of scope.

## Install

```bash
pnpm add @firfi/voila-sdk effect
```

The package is ESM-only and supports Node.js 20+.

## Quick Start

```ts
import { Either } from "effect"
import { bootstrapGuestSession, searchProducts, type VoilaTransport } from "@firfi/voila-sdk"

const responseHeadersFromFetch = (headers: Headers) => {
  const setCookie = headers.getSetCookie()
  const entries = Object.fromEntries(headers.entries())

  return setCookie.length === 0
    ? entries
    : {
      ...entries,
      "set-cookie": setCookie
    }
}

const fetchTransport: VoilaTransport = {
  request: async (request) => {
    const response = await fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
      redirect: "manual"
    })

    return Either.right({
      body: await response.text(),
      headers: responseHeadersFromFetch(response.headers),
      status: response.status
    })
  }
}

const bootstrap = await bootstrapGuestSession(fetchTransport)

if (Either.isLeft(bootstrap)) {
  throw new Error(bootstrap.left._tag)
}

const search = await searchProducts(
  bootstrap.right.session,
  {
    pageSize: 12,
    query: "milk"
  },
  fetchTransport
)

if (Either.isLeft(search)) {
  throw new Error(search.left._tag)
}

console.log(search.right.value.products.map((product) => product.name))
```

## What It Supports

- Guest session bootstrap from Voila homepage state.
- Product search and category product reads.
- Cart reads, item add/remove, and server-returned cart totals.
- Authenticated session health checks and authenticated cart reads.
- Delivery destination/context reads and guarded delivery context changes.
- Slot listing and guarded slot reservation input helpers.
- Checkout summary/readiness review.
- Completed order history reads with cursor pagination.
- Completed order detail reads with item groups, quantities, prices, and substitution/missing/return status.
- Completed-order item aggregation for questions like "what did I order last month?"
- Session snapshot save/load helpers.

The SDK does not place orders. Checkout APIs stop at review/readiness so a human can confirm in Voila.

## Authenticated Sessions

The SDK never accepts or stores a password. Use the local capture helper to log in interactively and save a session snapshot:

```bash
pnpm auth:capture
```

The command opens Chromium, waits for Voila session material, and writes:

```text
local-session-snapshots/voila-auth-session.json
```

That file is sensitive and ignored by git. Use it with `loadSdkSessionSnapshot` and `checkSessionHealth` before authenticated reads or cart mutations. See [docs/browser-login.md](docs/browser-login.md) and [docs/auth-readonly-smoke.md](docs/auth-readonly-smoke.md).

## Public API

Import only from the package entrypoint:

```ts
import { addCartItems, getCart, getCompletedOrderItems, getCompletedOrders, getOrderDetails, searchProducts } from "@firfi/voila-sdk"
```

Deep imports are unsupported. See [docs/public-api.md](docs/public-api.md) for the full public surface and [docs/usage-examples.md](docs/usage-examples.md) for end-to-end examples.

## Development

This repository follows the same quality harness as `../hulymcp`: Effect-first TypeScript, Effect Schema at I/O boundaries, strict linting, property tests, coverage gates, duplication checks, circular dependency checks, and Husky pre-commit hooks.

```bash
pnpm install
pnpm check-all
pnpm package:audit
```

`pnpm check-all` runs build, typecheck, circular dependency checks, lint/duplication checks, fixture audit, and coverage-gated tests.

`pnpm package:audit` builds the SDK and verifies the local npm dry-run package contents. See [docs/package-audit.md](docs/package-audit.md).

## Live Smoke Tests

Default checks never hit Voila. Live smoke tests are opt-in:

```bash
VOILA_LIVE_SMOKE=1 pnpm smoke:catalog-search
VOILA_LIVE_SMOKE=1 pnpm smoke:cart
VOILA_AUTH_SMOKE=1 VOILA_AUTH_SESSION_PATH=/absolute/path/to/sdk-session.json pnpm smoke:auth-readonly
VOILA_DRIFT_AUDIT=1 pnpm drift:audit
```

The catalog smoke bootstraps a guest session and searches `milk`.

The cart smoke uses a guest session, adds one available product, reads the server cart, removes that product, and verifies cleanup.

The authenticated read-only smoke loads a caller-provided authenticated SDK session snapshot, checks session health, searches `milk`, and reads the active cart.

The endpoint drift audit bootstraps a guest session, searches `milk`, and reads the guest cart to detect likely Voila response-schema drift.

## Release

Use the release gate before publishing:

```bash
pnpm release:check
npm publish
```

The package tarball intentionally contains only `package.json`, `README.md`, `LICENSE`, and `dist/src/**`. See [docs/release.md](docs/release.md).

## MCP And CLI

The workspace also publishes `@firfi/voila-mcp` and `@firfi/voila-cli`. Both use this SDK for Voila endpoint behavior; MCP owns the shared operation registry and the CLI reuses it. See [docs/mcp-readiness.md](docs/mcp-readiness.md).

## Safety

- Do not store Voila passwords.
- Treat session snapshots, browser profiles, cookies, and CSRF tokens as secrets.
- Do not log cookies, CSRF tokens, payment data, addresses, or account identifiers.
- Do not place an order without explicit caller confirmation from the latest checkout summary.
- Use [docs/safety-review-checklist.md](docs/safety-review-checklist.md) before merging changes that touch live network behavior, auth, cart mutation, slots, checkout review, fixtures, or diagnostics.
