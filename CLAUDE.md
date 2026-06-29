# Project Instructions

Rules are reflexive: when adding a rule, apply it immediately.

## Design Principle: Personal Automation SDK

The primary consumer of this SDK is a coding agent or local automation script assisting one user with Voila grocery workflows. Optimize for predictable, auditable actions over clever hidden behavior. Prefer small, explicit operations such as `searchProducts`, `addCartItems`, and `getCart` over broad workflows that mutate checkout state invisibly.

Voila does not publish a documented third-party customer API. This SDK uses the same same-origin JSON endpoints as the web app. Treat those endpoints as unstable, unofficial, and session-sensitive. Do not crawl broadly, bypass controls, defeat rate limits, or automate account login by storing passwords. Authenticated work must use an interactive browser login/session capture flow.

Never place an order without an explicit caller confirmation step based on the latest server checkout summary.

## Workspace Layout

The root package is private. Publishable packages live under `packages/`:

- `packages/voila-sdk`: `@firfi/voila-sdk`.
- `packages/voila-mcp`: `@firfi/voila-mcp`, stdio MCP server.
- `packages/voila-cli`: `@firfi/voila-cli`, user CLI.

The MCP package owns the shared operation registry used by both MCP tools and CLI commands.

## Project Harness

This project follows the `../hulymcp` TypeScript/Effect quality harness. These components are mandatory:

1. Test coverage (`vitest.config.ts`): v8 provider, 99% thresholds, `test:coverage` script.
2. Code duplication (`.jscpd.json` + `jscpd packages/*/src` in `lint`): threshold 2%, console reporter.
3. Circular dependency detection (`madge --circular` in `circular`, wired into `check-all`).
4. Pre-commit hooks (`.husky/pre-commit`): lint-staged plus secrets scanning when `gitleaks` is installed.
5. `pnpm check-all`: build + typecheck + circular + lint + fixture audit + test coverage.
6. Effect testing: use Effect-aware patterns and keep side effects behind ports/layers.
7. ESLint: Effect dprint formatting, functional rules, cast bans, mock bans, property-test placement.
8. Property tests: `fast-check` imports belong in `*.property.test.ts` only.
9. Strict TypeScript: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.

Missing any of these degrades the quality gate. Coverage and duplication checks are especially easy to forget.

Line-count limits are architecture signals. If `max-lines` fails, split the file along a coherent module boundary; do not compress or game lines.

## Package Manager

Use `pnpm`, not npm. Prefer package scripts over raw commands.

## Publish Readiness

When the user asks to publish or prepare a publish, bump every changed publishable package before finishing. The user-facing publish path must stay one command:

```bash
pnpm release:publish
```

Do not leave the user to manually edit package versions. After bumping, run the release checks, commit, and push so the user only has to run the one publish command on their host.

## Verification

Run before considering work complete:

```bash
pnpm check-all
```

For publish readiness, also run:

```bash
pnpm package:audit
```

For live endpoint changes, also run a controlled manual smoke test against a throwaway/guest session. Never run live cart mutation tests against a real account unless the test is explicitly designed to clean up and the caller asked for it.

## Type Safety

Type casts (`as T`) are banned. Avoid them. All data crossing system boundaries must be strongly typed with Effect Schema.

### Schema as Source of Truth at I/O Boundaries

At every I/O boundary, Effect Schema owns the payload contract. Examples include Voila HTTP responses, request payloads, SDK DTOs, files, environment/config, cookies/session snapshots, and serialized cache data.

Define schema first and derive the TypeScript type:

```ts
export const FooSchema = Schema.Struct({ ... })
export type Foo = Schema.Schema.Type<typeof FooSchema>
```

Hand-written interfaces are reserved for internal-only ports, services, and implementation details that are not parsed, encoded, serialized, or exposed across a boundary. If a boundary-adjacent type is intentionally not schema-derived, leave a short comment explaining why.

### Optional Boundary Fields

With `exactOptionalPropertyTypes`, schema-owned payloads should let Effect Schema derive optional behavior. Mappers should omit absent fields rather than write explicit `undefined`, unless explicit `undefined` is actually part of the accepted contract.

### Parse, Don't Validate

Boundary code must turn unknown or less-structured input into domain types as early as practical. Do not validate a raw DTO and then pass the raw value onward. Pass the parsed/refined value so downstream code can rely on what was learned.

Use names that preserve meaning:

- `parseX(input)` for untrusted input returning a typed value or typed parse error.
- `makeX(...)` / `createX(...)` for smart constructors from already-typed pieces.
- `isX(value): boolean` only for true predicates.

Expected parse, domain, authorization, integration, and persistence failures must stay in typed Effect error channels. Throwing/rejected promises are only for defects, framework-required behavior, or startup/bootstrap failures.

## Functional Core, Imperative Shell

Keep reusable behavior out of HTTP/session glue. The functional core contains domain logic, parsers, state transitions, cart delta construction, projection/mapping decisions, and checkout safety decisions. It avoids I/O, hidden dependencies, ambient time/randomness, thrown expected failures, and framework concerns.

The imperative shell owns Effect sequencing, Voila network I/O, cookie jars, config loading, local session storage, browser login, resource lifetime, and protocol translation.

## Config, Secrets, and Session State

Parse configuration at startup or the earliest request boundary into typed config with redacted secret values. Do not read `process.env` throughout the app.

Secrets such as cookies, session headers, tokens, passwords, API keys, and credential headers must be wrapped or isolated at the boundary and unwrapped only inside the adapter that needs the raw value. Do not put raw secrets in errors, logs, traces, snapshots, diagnostics, test fixtures, or tool results.

Voila session state is meaningful:

- Cookies identify visitor/account state.
- `X-CSRF-TOKEN` is required for writes.
- `page-view-id`, `client-route-id`, `ecom-request-source`, and `ecom-request-source-version` should be preserved from the server-rendered page.
- Product price and availability are only authoritative for the current region, destination, slot, and checkout context.

## Voila API Rules

Use JSON endpoints discovered from the web app, not HTML scraping, when possible.

Observed baseline endpoints:

- `GET /api/webproductpagews/v6/product-pages/search`
- `GET /api/webproductpagews/v6/product-pages`
- `POST /api/cart/v1/carts/active/apply-quantity`
- `GET /api/cart/v2/carts/active/cart-view`
- `GET /api/customersessions/v2/sessions/active`
- `GET /api/ecomslots/v2/slots`
- `POST /graphql` for completed order history.
- `GET /api/order/v6/orders/{orderId}/decorated` for completed order item details.

Treat endpoint schemas as versioned by tests. When a live response shape changes, update the Effect Schema and tests together.

Cart writes must:

- Use product UUIDs, not retailer display IDs, for mutations.
- Return and expose `limitedItems`, `unavailableData`, and pricing notifications.
- Prefer quantity deltas over guessed absolute state unless the API contract is proven.
- Clean up after smoke tests.

Checkout/order placement must:

- Fetch the latest checkout summary first.
- Surface substitutions, unavailable items, payment state, delivery fees, taxes, and final confirmation text.
- Require explicit caller confirmation before final placement.

## No Test Mocks

Test mocks are banned. Do not use `vi.mock`, `vi.doMock`, `vi.hoisted`, `vi.spyOn`, `vi.stubGlobal`, Jest-style `jest.mock`, or module-level monkey-patching.

If a test needs to substitute behavior, expose a dependency-injection seam: an Effect `Context.Tag` / service provided via `Layer`, or a plain ports argument. Tests then provide a real stub implementation through that seam.

This applies to every side effect, including time. Code that reads the clock must depend on Effect Clock or a Clock-like service.

## Formatting

Formatting is handled by `@effect/dprint` via ESLint.

- `pnpm format` auto-formats files.
- `pnpm check-format` checks formatting without writing.

## Worktree Safety

Never revert user changes unless explicitly requested. Before deleting branches/worktrees, check for uncommitted changes and unmerged commits.
