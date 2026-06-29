# Safety Review Checklist

Use this checklist before merging changes that touch live network behavior, authenticated sessions, cart mutations, slot handling, checkout review, fixture refreshes, or logging/diagnostics.

## Required Gate

- [ ] `pnpm check-all` passes.
- [ ] Default tests and checks do not hit Voila.
- [ ] Any live check is opt-in through an explicit environment flag.
- [ ] Expected runtime failures are typed and redacted.
- [ ] New boundary payloads are parsed with Effect Schema.

## Secrets and Fixtures

- [ ] No cookies, CSRF tokens, session IDs, auth headers, account identifiers, addresses, delivery notes, phone numbers, emails, or payment data are logged.
- [ ] No raw session snapshots or browser profiles are committed.
- [ ] New or refreshed fixtures use `sanitized-*` placeholders for sensitive values.
- [ ] `pnpm fixtures:audit` passes after fixture changes.
- [ ] Raw captures stayed in `.reference/fixture-refresh/`, `local-session-snapshots/`, or outside the repository and were deleted or kept ignored.

## Authenticated Flows

- [ ] The SDK still does not accept or store Voila passwords.
- [ ] Authentication uses interactive browser login/session capture only.
- [ ] Session snapshots are loaded and saved only through caller-provided storage.
- [ ] Auth smoke tests are read-only unless the reviewer explicitly approves a scoped mutation test.
- [ ] Reauthentication states are surfaced as typed status or typed errors, not hidden retries.

## Live Network Changes

- [ ] Endpoint paths and request builders are covered by offline tests.
- [ ] Live scripts print typed failure tags, operation names, and counts only.
- [ ] Live scripts do not print request headers, cookies, CSRF tokens, session paths, account identifiers, addresses, or payment state.
- [ ] For endpoint/schema changes, `VOILA_DRIFT_AUDIT=1 pnpm drift:audit` was run or intentionally deferred with a reason.
- [ ] Network retry behavior does not crawl broadly, bypass controls, or defeat rate limits.

## Cart Mutations

- [ ] Mutations use product UUIDs, not retailer display IDs.
- [ ] Quantity changes are explicit and bounded.
- [ ] Mutation responses expose server totals, unavailable items, limited items, and pricing notifications.
- [ ] Live mutation smoke tests use guest sessions unless the caller explicitly asks for authenticated mutation testing.
- [ ] Any live cart mutation has cleanup logic and reports a typed cleanup failure if cleanup cannot be verified.

## Slot and Shopping Context

- [ ] Slot listing operations remain read-only.
- [ ] Slot reservation requires explicit caller-provided slot input.
- [ ] Slot reservation surfaces expiry, unavailability, and API rejection as typed outcomes.
- [ ] Shopping context changes expose server warnings or cart-impact information.
- [ ] No read-only operation reserves a slot, changes delivery context, or mutates cart state.

## Checkout and Order Safety

- [ ] No public API places an order.
- [ ] Checkout operations fetch and parse the latest server checkout summary.
- [ ] Checkout readiness remains a review decision, not a placement workflow.
- [ ] Any future order-placement proposal requires a separate PRD/update, latest summary re-fetch, final confirmation text, and explicit caller confirmation.
- [ ] Checkout review surfaces substitutions, unavailable items, payment state, fees, taxes, and restrictions needed for a human review.

## Documentation

- [ ] README and relevant docs describe new live flags, safety behavior, and failure interpretation.
- [ ] Usage examples avoid credentials, cookies, CSRF tokens, addresses, account identifiers, and payment data.
- [ ] New public APIs are documented in `docs/public-api.md` and examples are updated when useful.
