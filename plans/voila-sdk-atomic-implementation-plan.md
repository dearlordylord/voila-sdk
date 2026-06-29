# Plan: Voila SDK Atomic Implementation Backlog

> Source PRD: `docs/PRD.md`

This plan translates the PRD into byte-sized implementation issues. Each issue is intended to be independently assignable once its listed inputs exist. Every issue must preserve the repo harness and finish with `pnpm check-all` unless explicitly marked documentation-only.

## Architectural Decisions

Durable decisions that apply to all issues:

- **Product shape**: expose both Voila product UUIDs and retailer product IDs. Product UUIDs are the cart mutation identifier.
- **Session shape**: preserve cookies, CSRF token, region, page-view ID, route ID, and asset/source version from Voila's server-rendered state.
- **Transport boundary**: all live Voila calls pass through a small HTTP/session adapter. Domain modules build requests and parse responses without performing network I/O.
- **Schema ownership**: all Voila responses, request payloads, session snapshots, config, and persisted session data are Effect Schema-owned.
- **Auth approach**: authenticated support uses interactive browser login/session capture only. No password storage or replayed login forms.
- **Ordering boundary**: no automatic final order placement in this plan. Checkout helpers may prepare/review state only.
- **Testing boundary**: ordinary tests do not hit Voila. Live smoke tests are opt-in, use guest sessions where possible, and clean up cart mutations.
- **Public API boundary**: library-first; CLI and public npm publishing are later concerns. Public exports should be npm-ready.

## Global Acceptance Gate

For every code issue:

- `pnpm check-all` passes.
- No secrets, cookies, CSRF tokens, account identifiers, addresses, or payment data are committed.
- New boundary payloads are parsed with Effect Schema.
- Tests assert public/module behavior, not private implementation details.
- No `vi.mock`, `vi.spyOn`, module monkey-patching, unchecked casts, or raw environment reads are introduced.

---

## Milestone 0: Baseline Harness

### Issue 0.1: Repository Harness Baseline

**Status**: Complete.

**User stories**: 17, 19, 22, 23, 27, 28, 29, 30

**Input**

- Empty repository.
- `../hulymcp` guidance and harness.

**Output**

- Effect-first TypeScript package skeleton.
- Strict lint/type/test/coverage harness.
- Voila-specific agent guidance.

**Expected artifacts**

- Package metadata and lockfile.
- TypeScript, ESLint, Vitest, madge, jscpd, Husky, editor, and ignore configs.
- `AGENTS.md`/project guidance.
- Initial schema/domain/request-builder modules and tests.

**Verification**

- `pnpm check-all` passes.
- `.husky/pre-commit` runs successfully.

---

## Milestone 1: Guest Session Tracer Bullet

### Issue 1.1: Homepage Initial-State Extraction Contract

**User stories**: 12, 17, 18, 19, 23, 24, 30

**Input**

- Sanitized sample Voila homepage HTML containing `window.__INITIAL_STATE__`.
- Current session schemas.

**Output**

- A pure parser that extracts and decodes the Voila initial state from homepage HTML.
- Typed parse failure when the script tag or JSON payload is missing/malformed.

**Expected artifacts**

- Initial-state extraction module.
- Sanitized HTML fixture.
- Unit tests for success, missing state, malformed JSON, and schema mismatch.

**Verification**

- Passing tests prove a homepage HTML string becomes typed session/bootstrap data.
- Passing tests prove malformed inputs produce typed errors without thrown expected failures.
- `pnpm check-all` passes.

### Issue 1.2: Cookie Jar Port and Session Snapshot Schema

**User stories**: 12, 15, 17, 18, 23, 30

**Input**

- Session metadata schema.
- Need to preserve Voila cookies without leaking them.

**Output**

- A cookie/session persistence boundary that can serialize and deserialize SDK session snapshots.
- Session snapshots are schema-owned and explicitly treated as sensitive.

**Expected artifacts**

- Session snapshot schema.
- Cookie jar port abstraction.
- Tests for round-trip serialization, missing fields, and redaction-safe display.

**Verification**

- Session snapshot encode/decode tests pass.
- Tests prove secret-bearing fields are not included in diagnostic/display helpers.
- `pnpm check-all` passes.

### Issue 1.3: Voila HTTP Client Port

**User stories**: 12, 17, 18, 19, 23, 24, 30

**Input**

- Header builder.
- Session snapshot/cookie jar port.

**Output**

- A small HTTP client port for same-origin Voila API calls.
- Typed errors for network failure, non-2xx response, malformed JSON, schema decode failure, missing CSRF, and expired/unauthorized session.

**Expected artifacts**

- HTTP client port and implementation.
- Typed SDK error model.
- Tests using injected fake transport, not mocks.

**Verification**

- Tests cover success and each typed error category.
- No tests use module mocking or live network.
- `pnpm check-all` passes.

### Issue 1.4: Guest Session Bootstrap

**User stories**: 4, 12, 17, 18, 19, 23, 24, 30

**Input**

- Initial-state extraction.
- Cookie jar/session snapshot boundary.
- HTTP client port.

**Output**

- A public library operation that creates a guest Voila session from the homepage.
- The operation returns typed session metadata, CSRF state, region, and guest cart summary.

**Expected artifacts**

- Guest bootstrap SDK operation.
- Tests for successful bootstrap with fixture transport.
- Tests for missing cookies, missing CSRF, and malformed initial state.

**Verification**

- A caller can bootstrap a guest session using injected transport and fixture HTML.
- `pnpm check-all` passes.

---

## Milestone 2: Catalog Search Tracer Bullet

### Issue 2.1: Catalog Search Request Model

**User stories**: 1, 4, 6, 17, 19, 22, 23, 24

**Input**

- Existing search URL builder.
- PRD catalog requirements.

**Output**

- A schema-owned search input model with query, page size, optional page token, and optional category context.
- Deterministic request construction for Voila search endpoints.

**Expected artifacts**

- Search input schema.
- Search request builder.
- Unit/property tests for query encoding, page size bounds, optional page token, and stable endpoint path.

**Verification**

- Tests prove equivalent input produces the same request.
- Tests prove invalid search input fails at the boundary.
- `pnpm check-all` passes.

### Issue 2.2: Catalog Search Response Normalization

**User stories**: 1, 2, 3, 4, 6, 17, 18, 22, 23, 24

**Input**

- Sanitized live search response fixture.
- Product search response schema.

**Output**

- Normalized public product search result with products, pagination metadata, and raw-context omissions where appropriate.

**Expected artifacts**

- Search response parser/normalizer.
- Fixture tests for product IDs, retailer IDs, price, unit price, availability, image, and quantity-in-cart fields.

**Verification**

- Tests prove normalized results expose all PRD-required product fields.
- Tests prove schema drift fails at parse boundary.
- `pnpm check-all` passes.

### Issue 2.3: Public `searchProducts` Operation

**User stories**: 1, 2, 3, 4, 6, 17, 18, 19, 22, 23, 24

**Input**

- Guest/auth session object.
- Search request model.
- Search response normalizer.
- HTTP client port.

**Output**

- A public library operation that searches Voila products through the active session.

**Expected artifacts**

- Public SDK search operation.
- Tests with injected transport verifying request headers, request URL, response parse, and error propagation.

**Verification**

- A caller with a typed session can call search and receive typed products.
- Network/API/schema errors are typed and recoverable.
- `pnpm check-all` passes.

### Issue 2.4: Catalog Search Live Smoke Test

**User stories**: 1, 2, 3, 4, 20, 24, 27, 30

**Input**

- Public guest bootstrap.
- Public search operation.
- Live smoke-test opt-in convention.

**Output**

- Opt-in live smoke test that bootstraps a guest session and searches a harmless query such as `milk`.

**Expected artifacts**

- Live smoke script or test entrypoint excluded from default unit test execution.
- Documentation for required environment flag and safety behavior.

**Verification**

- Default `pnpm check-all` does not hit the network.
- When explicitly enabled, the smoke test returns at least one product or a typed live-service failure.
- No secrets are written to disk.

---

## Milestone 3: Category Browse and Product Discovery

### Issue 3.1: Category Tree Extraction and Normalization

**User stories**: 5, 17, 18, 19, 22, 23, 24

**Input**

- Homepage initial state fixture with categories.
- Existing initial-state parser.

**Output**

- Normalized category tree exposed from session/bootstrap state.

**Expected artifacts**

- Category schemas and normalizer.
- Tests for root categories, child categories, retailer category IDs, and full URL paths.

**Verification**

- Tests prove category IDs and retailer IDs are distinct and preserved.
- `pnpm check-all` passes.

### Issue 3.2: Category Page Request and Response Contract

**User stories**: 2, 3, 5, 6, 17, 18, 19, 22, 23, 24

**Input**

- Known category endpoint shape.
- Sanitized category page fixture.

**Output**

- Request model and response parser for category product pages.

**Expected artifacts**

- Category page request schema.
- Category product response schema/normalizer.
- Tests for category ID, retailer category ID, filters, pagination, and product normalization.

**Verification**

- Tests prove category product discovery has the same product field guarantees as search.
- `pnpm check-all` passes.

### Issue 3.3: Public `getCategoryProducts` Operation

**User stories**: 2, 3, 5, 6, 17, 18, 19, 22, 23, 24

**Input**

- Category page request/response contract.
- HTTP client port.
- Active session.

**Output**

- Public library operation for category browsing with pagination.

**Expected artifacts**

- Public SDK category operation.
- Tests with injected transport for success and typed error propagation.

**Verification**

- A caller can request category products using category ID or retailer category ID.
- `pnpm check-all` passes.

---

## Milestone 4: Guest Cart Tracer Bullet

### Issue 4.1: Cart View Response Contract

**User stories**: 9, 10, 11, 17, 18, 19, 22, 23, 24

**Input**

- Known cart view endpoint.
- Sanitized empty and non-empty cart fixtures.

**Output**

- Schema-owned cart view parser and normalized public cart model.

**Expected artifacts**

- Cart view schemas.
- Cart normalizer.
- Fixture tests for empty cart, product rows, totals, checkout restrictions, unavailable data, and pricing notifications.

**Verification**

- Tests prove cart totals are server-derived.
- Tests prove unavailable/limited/pricing signals are preserved.
- `pnpm check-all` passes.

### Issue 4.2: Public `getCart` Operation

**User stories**: 9, 10, 11, 12, 17, 18, 19, 22, 23, 24

**Input**

- Cart view response contract.
- HTTP client port.
- Active session.

**Output**

- Public library operation for fetching the active cart.

**Expected artifacts**

- Public SDK cart read operation.
- Tests for request shape, response parse, and typed error propagation.

**Verification**

- A caller can fetch a typed cart from an active guest/auth session.
- `pnpm check-all` passes.

### Issue 4.3: Cart Quantity Request Contract

**User stories**: 7, 8, 10, 11, 17, 18, 19, 22, 23, 24

**Input**

- Existing cart delta constructor.
- Known apply-quantity endpoint behavior.

**Output**

- Schema-owned cart quantity mutation input with product UUID and delta quantity.
- Guardrails for zero quantity, non-finite quantity, missing product ID, and accidental retailer-ID usage where detectable.

**Expected artifacts**

- Cart mutation input schema.
- Request builder tests.
- Property tests for add/remove sign normalization.

**Verification**

- Tests prove add quantities are positive deltas and remove quantities are negative deltas.
- Invalid mutation inputs fail before network I/O.
- `pnpm check-all` passes.

### Issue 4.4: Cart Mutation Response Contract

**User stories**: 7, 8, 10, 11, 17, 18, 19, 22, 23, 24

**Input**

- Sanitized apply-quantity success fixture.
- Sanitized limited/unavailable fixture.

**Output**

- Parser/normalizer for cart mutation responses.

**Expected artifacts**

- Cart mutation response schema.
- Tests for updated totals, item groups, limited items, unavailable data, pricing notifications, and promotions.

**Verification**

- Tests prove mutation responses expose server-returned totals and warnings.
- `pnpm check-all` passes.

### Issue 4.5: Public `applyCartDeltas` Operation

**User stories**: 7, 8, 10, 11, 12, 17, 18, 19, 22, 23, 24

**Input**

- Cart mutation request/response contracts.
- HTTP client port.
- Active session.

**Output**

- Public library operation for applying one or more cart quantity deltas.

**Expected artifacts**

- Public SDK cart mutation operation.
- Tests for batch request body, headers, response parse, and typed API failures.

**Verification**

- A caller can apply typed deltas and receive a typed cart mutation result.
- `pnpm check-all` passes.

### Issue 4.6: Public `addCartItems` and `removeCartItems` Convenience Operations

**User stories**: 7, 8, 10, 11, 12, 17, 18, 19, 22, 23, 24

**Input**

- Public `applyCartDeltas` operation.
- Cart delta domain helpers.

**Output**

- Convenience operations that build safe deltas and delegate to the lower-level mutation operation.

**Expected artifacts**

- Public add/remove operations.
- Tests proving they delegate behavior through observable requests/results, not implementation inspection.

**Verification**

- Add/remove tests prove correct request bodies and normalized results.
- `pnpm check-all` passes.

### Issue 4.7: Guest Cart Live Smoke Test with Cleanup

**User stories**: 7, 8, 9, 10, 11, 20, 21, 24, 27, 30

**Input**

- Guest bootstrap.
- Search operation.
- Cart read/mutation operations.
- Live smoke-test opt-in convention.

**Output**

- Opt-in live smoke test that searches for an available product, adds one unit to a guest cart, verifies server totals, removes it, and verifies cleanup.

**Expected artifacts**

- Live cart smoke test/script.
- Documentation of safety and opt-in execution.

**Verification**

- Default `pnpm check-all` does not hit the network.
- Explicit smoke run performs add/remove cleanup or reports a typed cleanup failure.
- No live cookies or session data are committed.

---

## Milestone 5: Authenticated Session Support

### Issue 5.1: Auth Session State Model

**User stories**: 13, 15, 16, 17, 18, 22, 23, 30

**Input**

- Guest session snapshot schema.
- Authenticated workflow requirements.

**Output**

- Schema-owned authenticated session snapshot that can represent logged-in state, expiry uncertainty, and reauth requirements.

**Expected artifacts**

- Auth session schema.
- Tests for encode/decode, missing sensitive fields, and reauth-required state.

**Verification**

- Auth snapshots round-trip without exposing secrets in diagnostic helpers.
- `pnpm check-all` passes.

### Issue 5.2: Interactive Browser Login Port

**User stories**: 13, 14, 15, 16, 18, 22, 23, 29, 30

**Input**

- Auth session state model.
- Requirement to avoid password storage.

**Output**

- A browser-login port that can be implemented with Playwright or another browser automation adapter without coupling SDK core to that implementation.

**Expected artifacts**

- Auth login port.
- No-op/fake test implementation through dependency injection.
- Tests for success, user cancellation, timeout, and missing cookies.

**Verification**

- Tests prove auth flow can be exercised without mocks or real browser.
- Public SDK does not require password input.
- `pnpm check-all` passes.

### Issue 5.3: Browser Login Adapter

**User stories**: 13, 14, 15, 16, 18, 20, 22, 23, 30

**Input**

- Interactive browser login port.
- Voila/Gigya OIDC redirect behavior.

**Output**

- Optional adapter that opens an interactive browser, lets the user log in, captures the resulting Voila session cookies, and returns a typed authenticated session snapshot.

**Expected artifacts**

- Browser login adapter.
- Documentation for local usage and expected browser behavior.
- Integration-style test that exercises adapter boundaries without storing credentials.

**Verification**

- No password parameter exists in the public API.
- Adapter can be invoked manually and either returns a typed session or a typed cancellation/timeout error.
- `pnpm check-all` passes.

### Issue 5.4: Session Save/Load API

**User stories**: 13, 15, 16, 18, 22, 23, 30

**Input**

- Auth/guest session snapshot schemas.
- Cookie/session persistence boundary.

**Output**

- Public operations to save and load sensitive session snapshots from caller-provided storage.

**Expected artifacts**

- Storage port.
- Save/load operations.
- Tests with in-memory storage implementation.

**Verification**

- Session state round-trips through storage.
- Corrupt or stale session files return typed errors.
- No raw session values appear in errors.
- `pnpm check-all` passes.

### Issue 5.5: Session Health and Reauthentication Detection

**User stories**: 13, 15, 16, 17, 18, 22, 23

**Input**

- Active session endpoint.
- Auth/guest session snapshot model.
- HTTP client port.

**Output**

- Public operation that checks whether a session is active, expired, unauthorized, or requires reauthentication.

**Expected artifacts**

- Session health response schema.
- Public session health operation.
- Tests for active, unauthorized, malformed, and expired/reauth states.

**Verification**

- Callers can distinguish "try again", "log in again", and "API shape changed".
- `pnpm check-all` passes.

---

## Milestone 6: Account-Aware Shopping Context

### Issue 6.1: Delivery Destination Read Contract

**User stories**: 4, 12, 13, 16, 17, 18, 22, 23, 24, 30

**Input**

- Authenticated session support.
- Known delivery destination endpoint family.

**Output**

- Read-only schema and operation for available/saved delivery destinations.

**Expected artifacts**

- Delivery destination schemas.
- Public read operation.
- Sanitized fixture tests.

**Verification**

- Tests prove addresses or account identifiers are sanitized in fixtures and diagnostics.
- `pnpm check-all` passes.

### Issue 6.2: Delivery Proposition/Active Context Contract

**User stories**: 4, 12, 13, 16, 17, 18, 22, 23, 24

**Input**

- Delivery destination read operation.
- Active session/proposition endpoint knowledge.

**Output**

- Read/set operation for shopping proposition context where safe and necessary for accurate catalog/cart state.

**Expected artifacts**

- Proposition schemas.
- Context request builders.
- Tests for delivery vs pickup proposition behavior using fixtures.

**Verification**

- Tests prove context-changing operations surface cart impact warnings where present.
- `pnpm check-all` passes.

### Issue 6.3: Account-Aware Search and Cart Smoke Test

**User stories**: 4, 12, 13, 16, 20, 21, 24, 30

**Input**

- Auth session load.
- Search/cart operations.
- Live smoke-test opt-in convention.

**Output**

- Optional live smoke flow using a caller-provided authenticated session snapshot to search and read cart without committing credentials.

**Expected artifacts**

- Auth smoke test/script.
- Documentation for required local session setup.

**Verification**

- Smoke test refuses to run without explicit opt-in and local session path.
- No session data is committed.
- Read-only auth smoke passes or returns typed auth/session error.

---

## Milestone 7: Slot and Checkout Review, No Placement

### Issue 7.1: Slot Listing Read Contract

**Status**: Complete.

**User stories**: 4, 13, 16, 17, 18, 22, 23, 24

**Input**

- Active shopping context.
- Known slot listing endpoint.

**Output**

- Schema-owned read-only operation for available delivery/pickup slots.

**Expected artifacts**

- Slot schemas.
- Slot read operation.
- Fixture tests for available, unavailable, and service-down responses.

**Verification**

- Callers can inspect slots without reserving them.
- `pnpm check-all` passes.

### Issue 7.2: Slot Reservation Guardrails

**Status**: Complete.

**User stories**: 4, 13, 16, 17, 18, 22, 23, 24, 25, 26

**Input**

- Slot listing operation.
- Known reservation endpoint.

**Output**

- Optional slot reservation operation with explicit caller action, typed expiry, and clear cleanup/overwrite behavior.

**Expected artifacts**

- Slot reservation schemas.
- Public reservation operation.
- Tests for explicit reservation request, expired slot, unavailable slot, and typed API rejection.

**Verification**

- No slot is reserved by read-only operations.
- Reservation requires explicit slot ID input.
- `pnpm check-all` passes.

### Issue 7.3: Checkout Summary Read Contract

**Status**: Complete.

**User stories**: 9, 10, 11, 13, 16, 17, 18, 22, 23, 25, 26, 30

**Input**

- Cart and optional slot context.
- Known checkout summary endpoint.

**Output**

- Read-only checkout summary parser exposing totals, fees, restrictions, unavailable items, substitutions, and confirmation-relevant warnings.

**Expected artifacts**

- Checkout summary schemas.
- Public checkout summary read operation.
- Fixture tests for blocked checkout, missing slot, unavailable item, and ready-to-review states.

**Verification**

- Summary operation cannot place an order.
- Tests prove restrictions and warnings are preserved.
- `pnpm check-all` passes.

### Issue 7.4: Checkout Readiness Decision Model

**Status**: Complete.

**User stories**: 9, 10, 11, 13, 16, 17, 18, 22, 23, 25, 26, 30

**Input**

- Checkout summary model.
- PRD rule that final order placement is out of scope.

**Output**

- Pure domain decision that classifies checkout as blocked, needs review, or ready-for-manual-checkout.

**Expected artifacts**

- Checkout readiness model.
- Tests for each decision state.

**Verification**

- Tests prove no decision path places an order.
- Tests prove warnings/restrictions are not dropped.
- `pnpm check-all` passes.

---

## Milestone 8: Public API and NPM Readiness

### Issue 8.1: Public Export Audit

**Status**: Complete.

**User stories**: 17, 18, 22, 23, 27, 30

**Input**

- Implemented SDK modules.
- Package export requirements.

**Output**

- Deliberate public exports for session, catalog, cart, auth, context, slot, and checkout review operations.

**Expected artifacts**

- Public API export surface.
- Tests or type-level checks proving intended imports work.
- Documentation of unstable/internal modules.

**Verification**

- Consumers can import only documented public APIs from the package entrypoint.
- `pnpm check-all` passes.

### Issue 8.2: Public API Usage Examples

**Status**: Complete.

**User stories**: 1, 7, 8, 9, 13, 15, 22, 30

**Input**

- Public SDK operations.

**Output**

- Documentation examples for guest search, guest cart add/remove cleanup, interactive login, session save/load, authenticated cart read, and checkout review.

**Expected artifacts**

- README/API documentation updates.
- Example snippets that avoid secrets and do not place orders.

**Verification**

- Documentation examples align with public exports.
- No cookies, CSRF tokens, addresses, or credentials appear in examples.
- `pnpm check-all` passes.

### Issue 8.3: Package Build Artifact Verification

**Status**: Complete.

**User stories**: 22, 27

**Input**

- Package metadata and public exports.

**Output**

- NPM-ready package build verification without publishing.

**Expected artifacts**

- Build/package verification script.
- Package contents audit documentation or test.

**Verification**

- Local package dry-run includes only expected files.
- Build artifacts contain type declarations.
- `pnpm check-all` passes.

---

## Milestone 9: Drift Detection and Maintenance

### Issue 9.1: Sanitized Fixture Refresh Workflow

**Status**: Complete.

**User stories**: 17, 18, 20, 24, 27, 30

**Input**

- Existing live smoke scripts.
- Existing sanitized fixtures.

**Output**

- Maintainer workflow for refreshing live Voila fixtures while redacting sensitive data.

**Expected artifacts**

- Fixture refresh script or documented manual workflow.
- Sanitization checks.

**Verification**

- Refresh workflow refuses to write raw cookies, CSRF tokens, addresses, account identifiers, or payment data.
- `pnpm check-all` passes.

### Issue 9.2: Endpoint Drift Smoke Audit

**Status**: Complete.

**User stories**: 17, 18, 20, 24, 27

**Input**

- Guest bootstrap/search/cart smoke tests.
- Schema parsers.

**Output**

- Opt-in smoke audit that checks whether core endpoints still match SDK schemas.

**Expected artifacts**

- Drift audit script/test.
- Documentation on interpreting typed drift failures.

**Verification**

- Default checks remain offline.
- Explicit drift audit either passes or reports endpoint/schema drift by operation.

### Issue 9.3: Safety Review Checklist

**Status**: Complete.

**User stories**: 20, 21, 25, 26, 30

**Input**

- Implemented SDK operations.
- PRD safety requirements.

**Output**

- Maintainer checklist for reviewing live network, auth, cart, slot, and checkout changes.

**Expected artifacts**

- Safety checklist documentation.

**Verification**

- Checklist covers secrets, live mutation cleanup, auth flow, no password storage, no blind checkout, and fixture sanitization.
- Documentation-only change; run `pnpm check-all` if nearby code changed.
