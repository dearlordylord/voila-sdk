# Public API

The SDK package exposes a single public entrypoint:

```ts
import { bootstrapGuestSession, searchProducts } from "@firfi/voila-sdk"
```

Deep imports such as `@firfi/voila-sdk/dist/voila/urls.js` are not public. The package `exports` map intentionally exposes only `"."`.

The MCP and CLI packages are separate workspace packages:

```ts
import { runVoilaOperation } from "@firfi/voila-mcp"
```

`@firfi/voila-mcp` owns the shared operation registry reused by `@firfi/voila-cli`. The CLI package is primarily an executable package with bin `voila`.

## Stable Library Operations

- Session bootstrap and storage: `bootstrapGuestSession`, `makeGuestSdkSessionSnapshot`, `makeAuthenticatedSdkSessionSnapshot`, `saveSdkSessionSnapshot`, `loadSdkSessionSnapshot`.
- Auth: `loginWithBrowser`, `createInteractiveBrowserLoginPort`, browser-login port types.
- Session health: `checkSessionHealth`.
- Catalog: `searchProducts`, `getCategoryProducts`, `getInitialStateCategories`, `normalizeCategoryTree`.
- Cart: `getCart`, `applyCartDeltas`, `addCartItems`, `removeCartItems`.
- Delivery context: `getDeliveryDestinations`, `getDeliveryDestination`, `getActiveShoppingContext`, `getDeliveryPropositionDetails`, `previewDeliveryContextChange`, `applyDeliveryContextChange`.
- Slot review and guarded reservation: `getSlotListings`, `makeSlotReservationInputFromSlot`, `reserveSlot`.
- Checkout review: `getCheckoutSummary`, `decideCheckoutReadiness`.
- Order history: `getCompletedOrders`, `getOrderDetails`, `getCompletedOrderItems`.

## Public Data Contracts

Effect Schema contracts are exported from the package entrypoint for callers that need runtime validation around persisted data or SDK results. This includes session, search, cart, delivery, slot, checkout summary, checkout readiness, completed order, and order detail schemas.

Transport and storage ports are public so applications can provide their own HTTP, browser, and persistence adapters.

## Advanced Helpers

Request builders, parsers, normalizers, and low-level HTTP helpers are exported for deterministic tests and diagnostics. They are advanced API: they do not perform live I/O by themselves, but they may track Voila web-app endpoint drift more closely than the high-level operations.

No exported API places an order. Checkout APIs stop at read/review decisions and manual-checkout readiness.

## MCP Operations

The initial MCP/CLI operation surface is:

- `voila_check_session_health`
- `voila_search_products`
- `voila_get_category_products`
- `voila_get_completed_orders`
- `voila_get_order_details`
- `voila_get_completed_order_items`
- `voila_get_cart`
- `voila_add_cart_items`
- `voila_remove_cart_items`

These operations use SDK result shapes and redacted typed failures. Checkout and order placement are intentionally not exposed.
