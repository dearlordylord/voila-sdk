# Public API

The SDK package exposes a single public entrypoint:

```ts
import { bootstrapGuestSession, searchProducts, VoilaTransport } from "@firfi/voila-sdk"
```

Deep imports such as `@firfi/voila-sdk/dist/voila/urls.js` are not public. The package `exports` map intentionally exposes only `"."`.

The MCP and CLI packages are separate workspace packages:

```ts
import { nodeVoilaTransportLayer, runVoilaOperation } from "@firfi/voila-mcp"
```

`@firfi/voila-mcp` owns the shared operation registry reused by `@firfi/voila-cli`. The CLI package is primarily an executable package with bin `voila`.

## The Transport Service

Every operation that talks to Voila is an `Effect` requiring `VoilaTransport`:

```ts
class VoilaTransport extends Context.Tag("@firfi/voila-sdk/VoilaTransport")<VoilaTransport, {
  readonly request: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>
}>() {}
```

An adapter sends the request and reads the body; everything else — cookies, CSRF, redirect and blocking classification, schema decoding — belongs to the SDK. `VoilaTransportError` is the adapter's whole failure vocabulary, and carries no request material:

- `VoilaRequestDeadlineExceeded` — the request outlasted its deadline (carries `timeoutMs`).
- `VoilaConnectionFailure` — the request never reached the server.
- `VoilaResponseReadFailure` — the response body could not be read.

Smart constructors `requestDeadlineExceeded`, `connectionFailure`, and `responseReadFailure` are exported so an adapter names its failures in the SDK's vocabulary.

`@firfi/voila-mcp` exports `nodeVoilaTransportLayer(userAgent?, timeoutMs?)`: `@effect/platform`'s `HttpClient`, a stable browser identity, and a Clock-driven 30-second deadline that cancels the underlying request rather than abandoning the fiber waiting on it.

## Stable Library Operations

Operation signatures follow one shape: session first, input second, and an optional cookie-jar port last.

```ts
searchProducts(
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<SearchProductsResult, SearchProductsError, VoilaTransport>
```

- Session bootstrap and storage: `bootstrapGuestSession(cookieJarPort?)`, `makeGuestSdkSessionSnapshot`, `makeAuthenticatedSdkSessionSnapshot`, `loadSdkSessionSnapshot(storage)`. Storage is read-only; writes go through `@firfi/voila-session-store`.
- Auth: `loginWithBrowser`, `createInteractiveBrowserLoginPort`, browser-login port types. Browser login needs no transport.
- Session health: `checkSessionHealth(snapshot, cookieJarPort?)`.
- Catalog: `searchProducts`, `getCategoryProducts`, `getDiscountedProducts`, `getInitialStateCategories`, `normalizeRawCategories`.
- Cart: `getCart`, `applyCartDeltas`, `addCartItems`, `removeCartItems`.
- Delivery context: `getDeliveryDestinations`, `getDeliveryDestination`, `getActiveShoppingContext`, `getDeliveryPropositionDetails`, `previewDeliveryContextChange`, `applyDeliveryContextChange`.
- Slot review and guarded reservation: `getSlotListings`, `makeSlotReservationInputFromSlot`, `reserveSlot`.
- Checkout review: `getCheckoutSummary`, `decideCheckoutReadiness`.
- Order history: `getCompletedOrders`, `getOrderDetails`, `getCompletedOrderItems`.

Pure decisions and normalizers — `decideCheckoutReadiness`, `normalizeRawCategories`, `makeSlotReservationInputFromSlot` — are ordinary functions with no Effect and no transport.

## Errors

Expected failures live in the typed error channel: parse failures, Voila-side rejections, blocking, session-storage failures, and the transport failures above. Thrown exceptions are defects. `Effect.either` converts a failure into an `Either` where a caller would rather branch than short-circuit.

## Public Data Contracts

Effect Schema contracts are exported from the package entrypoint for callers that need runtime validation around persisted data or SDK results. This includes session, search, cart, delivery, slot, checkout summary, checkout readiness, completed order, and order detail schemas.

Transport, cookie-jar, browser, and storage ports are public so applications can provide their own adapters.

## Advanced Helpers

Request builders, parsers, normalizers, and low-level HTTP helpers are exported for deterministic tests and diagnostics. They are advanced API: they do not perform live I/O by themselves, but they may track Voila web-app endpoint drift more closely than the high-level operations.

Voila serves homepage categories in two shapes — a nested tree and a store keyed by category ID — and which one a session gets is not predictable from here. Both are decoded, and `normalizeRawCategories` resolves either into the same normalized tree; `normalizeCategoryTree` and `normalizeCategoryStore` are exported for a caller holding one specific shape.

No exported API places an order. Checkout APIs stop at read/review decisions and manual-checkout readiness.

## MCP Operations

`runVoilaOperation(name, input, environment)` runs one operation and returns `Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure>` — the environment carries the transport layer, so nothing is left for the caller to provide. The operation surface is:

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

These operations use SDK result shapes and redacted typed failures. Checkout and order placement are intentionally not exposed.
