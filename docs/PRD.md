# PRD: Voila Grocery SDK

## Problem Statement

The user wants a TypeScript SDK that can assist with ordering groceries from Voila. The SDK should support product discovery, grocery search, cart management, and authenticated account workflows while respecting that Voila does not publish a documented third-party customer API.

The current state is a researched and scaffolded SDK repository with a strict Effect-first quality harness. Research confirmed that Voila's web app uses same-origin JSON endpoints for catalog/search, cart updates, customer sessions, and slot-related workflows. These endpoints are unofficial, session-sensitive, and may change without notice. The SDK needs to make these capabilities usable without turning them into brittle scraping scripts or unsafe order automation.

## Solution

Build a library-first TypeScript SDK that wraps Voila web-app API behavior behind stable, schema-owned SDK modules. The SDK will bootstrap Voila browser-like sessions, maintain cookies and CSRF metadata, expose typed catalog and cart operations, and support authenticated sessions through interactive browser login/session capture.

The SDK should be npm-ready in its structure, packaging, exports, and public API design, even if publication is a later concern. It should use Effect and Effect Schema at I/O boundaries, follow the current repo quality harness, and keep live network behavior isolated behind adapters and explicit smoke-test workflows.

Order placement is not required for the first product scope. If order placement later turns out to be a flat, low-risk API call, it may be considered separately, but it must never happen without an explicit latest-checkout confirmation step.

## User Stories

1. As a grocery shopper, I want to search Voila products from code, so that I can build grocery lists faster.
2. As a grocery shopper, I want search results to include names, brands, pack sizes, prices, unit prices, availability, and images, so that I can compare products without opening the website.
3. As a grocery shopper, I want product IDs and retailer product IDs exposed distinctly, so that I can use the correct identifier for cart operations.
4. As a grocery shopper, I want search results to reflect my current Voila session context, so that prices and availability are relevant to my region and delivery state.
5. As a grocery shopper, I want to browse categories, so that I can discover products when search terms are not precise.
6. As a grocery shopper, I want pagination support, so that I can inspect more than one page of results.
7. As a grocery shopper, I want to add products to my cart from code, so that routine grocery ordering is less repetitive.
8. As a grocery shopper, I want to remove products from my cart from code, so that SDK actions can clean up mistakes and test mutations.
9. As a grocery shopper, I want to inspect the current cart, so that I can review totals before using Voila checkout.
10. As a grocery shopper, I want cart mutation results to expose unavailable items, limited items, and pricing notifications, so that I can understand what changed.
11. As a grocery shopper, I want cart totals returned from the server after each mutation, so that I do not rely on client-side price guesses.
12. As a grocery shopper, I want the SDK to preserve cookies and CSRF tokens correctly, so that cart operations work consistently.
13. As a grocery shopper, I want authenticated session support, so that the SDK can eventually use my saved addresses, favorites, regulars, and account-specific cart.
14. As a grocery shopper, I want authentication to happen through an interactive browser flow, so that my password is not stored by the SDK.
15. As a grocery shopper, I want session snapshots to be loadable and saveable, so that I do not have to log in repeatedly.
16. As a grocery shopper, I want session expiry to be detected clearly, so that I know when to re-authenticate.
17. As a developer, I want every Voila response parsed with Effect Schema, so that API drift is caught at boundaries.
18. As a developer, I want typed SDK errors for network failures, parse failures, auth failures, and API rejections, so that callers can recover intentionally.
19. As a developer, I want request builders to be deterministic and testable without network I/O, so that most tests are fast and reliable.
20. As a developer, I want live smoke tests to be opt-in and controlled, so that guest cart behavior can be verified without damaging real account state.
21. As a developer, I want cart smoke tests to clean up after themselves, so that live tests do not leave unwanted groceries in a cart.
22. As a developer, I want the public library API to be stable and npm-ready, so that future publication does not require a redesign.
23. As a developer, I want internal modules separated into functional core and imperative shell, so that domain logic remains easy to test.
24. As a developer, I want no HTML scraping where JSON endpoints exist, so that SDK behavior tracks the web app's structured contracts.
25. As a developer, I want no automatic order placement in the first scope, so that the SDK avoids high-risk purchasing behavior.
26. As a developer, I want checkout-related future work to require explicit confirmation, so that order automation cannot happen accidentally.
27. As a maintainer, I want `pnpm check-all` to remain the acceptance gate, so that build, typecheck, lint, circular dependency, duplication, and coverage checks all run together.
28. As a maintainer, I want property tests separated into property test files, so that randomized tests remain discoverable.
29. As a maintainer, I want no test mocks or monkey-patching, so that tests drive clean dependency boundaries.
30. As a maintainer, I want secrets redacted or isolated, so that cookies, CSRF tokens, account identifiers, and payment-related data never leak into logs or fixtures.

## Implementation Decisions

- The SDK will be library-first. CLI tooling can be considered later, but it must wrap the library rather than becoming the primary implementation.
- The package should remain npm-ready: public exports should be deliberate, package metadata should stay clean, and implementation modules should not leak unstable internal helpers as the main API.
- Effect and Effect Schema are required at I/O boundaries. Voila HTTP responses, request payloads, session snapshots, config, and stored session state must be schema-owned.
- The SDK will distinguish functional core modules from imperative shell modules. Request construction, cart delta creation, response normalization, and safety decisions belong in the core. Network calls, cookie jars, browser login, and session persistence belong in the shell.
- The first substantial capability should bootstrap a Voila session by fetching the homepage, parsing the server-rendered initial state, and extracting cookies, CSRF token, region, page metadata, and guest cart state.
- Catalog APIs should use Voila's structured JSON endpoints rather than scraping rendered HTML.
- Cart mutation APIs should use product UUIDs and quantity deltas. Retailer product IDs may be exposed for display and lookup, but should not be treated as cart mutation identifiers unless a specific endpoint requires them.
- Authenticated support is in scope. Authentication must use interactive browser login/session capture, not stored passwords or replayed login forms.
- Saved session data must be treated as sensitive. It must not be logged, committed, or included in fixtures.
- Live smoke tests are acceptable. They should default to guest sessions where possible and must clean up cart mutations.
- Order placement is out of scope for the first SDK product. Any later order placement API must re-fetch checkout state and require explicit confirmation.
- The SDK should expose typed errors instead of throwing for expected failures. Expected categories include network failure, malformed response, session expired, CSRF missing, unauthorized, unavailable product, limited quantity, and API rejection.
- The SDK should keep Voila API endpoint paths isolated in a small adapter layer so that endpoint drift is localized.
- Tests should lock down endpoint request shapes and response schema expectations using sanitized fixtures.

## Testing Decisions

- Good tests assert external behavior: decoded data, request URLs, request bodies, typed errors, session transitions, cart delta construction, and public SDK API behavior. They should not assert private implementation details.
- Schema tests must cover representative sanitized Voila responses for catalog search, cart updates, session bootstrap, and later authenticated/session APIs.
- Request-builder tests must run without network I/O and verify stable URL/query/header/body construction.
- Cart domain tests must cover add, remove, and quantity delta behavior, including sign normalization and cleanup-oriented operations.
- Property tests should be used for small deterministic transformations such as cart delta normalization, pagination parameter construction, and parse/encode round trips.
- Live smoke tests should be separate from default unit tests unless they can be made deterministic, safe, and fast. They should require explicit configuration and must clean up after cart writes.
- Auth tests should not use password mocks or module monkey-patching. Browser/session dependencies should be injected through ports or Effect services.
- Secrets must not appear in fixtures. Fixtures should be sanitized before being committed.
- `pnpm check-all` is the required completion gate for implementation work.

## Out of Scope

- Public npm publication and release automation for the first implementation phase.
- CLI commands as a primary interface.
- Automated final order placement.
- Payment method management.
- Bypassing Voila authentication, bot protections, rate limits, or access controls.
- Broad crawling of product catalogs beyond controlled SDK usage.
- Scraping HTML when a structured JSON endpoint exists.
- Support for non-Voila Sobeys banners unless the same architecture can support them later without distorting the Voila SDK.
- Mobile app reverse engineering beyond high-level comparison with web behavior.

## Further Notes

- Research was performed against the live Voila site in late June 2026. The web app exposed same-origin endpoints for product search and cart quantity application, and guest cart add/remove was validated with a throwaway session.
- Voila's `robots.txt` disallows `/api/` for crawlers. This SDK should remain a personal automation/library project and should avoid crawler-like behavior.
- Voila pricing and availability are location/session dependent. The SDK should present server-returned data as contextual, not globally authoritative.
- The repo already contains the intended quality harness, including strict TypeScript, Effect Schema, ESLint/dprint, Vitest coverage, property test placement rules, duplication checks, circular dependency checks, and Husky pre-commit hooks.
