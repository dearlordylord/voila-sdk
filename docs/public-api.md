# Public API

The npm package exposes a single public entrypoint:

```ts
import { bootstrapGuestSession, searchProducts } from "@firfi/voila-sdk"
```

Deep imports such as `@firfi/voila-sdk/dist/voila/urls.js` are not public. The package `exports` map intentionally exposes only `"."`.

## Stable Library Operations

- Session bootstrap and storage: `bootstrapGuestSession`, `makeGuestSdkSessionSnapshot`, `makeAuthenticatedSdkSessionSnapshot`, `saveSdkSessionSnapshot`, `loadSdkSessionSnapshot`.
- Auth: `loginWithBrowser`, `createInteractiveBrowserLoginPort`, browser-login port types.
- Session health: `checkSessionHealth`.
- Catalog: `searchProducts`, `getCategoryProducts`, `getInitialStateCategories`, `normalizeCategoryTree`.
- Cart: `getCart`, `applyCartDeltas`, `addCartItems`, `removeCartItems`.
- Delivery context: `getDeliveryDestinations`, `getDeliveryDestination`, `getActiveShoppingContext`, `getDeliveryPropositionDetails`, `previewDeliveryContextChange`, `applyDeliveryContextChange`.
- Slot review and guarded reservation: `getSlotListings`, `makeSlotReservationInputFromSlot`, `reserveSlot`.
- Checkout review: `getCheckoutSummary`, `decideCheckoutReadiness`.

## Public Data Contracts

Effect Schema contracts are exported from the package entrypoint for callers that need runtime validation around persisted data or SDK results. This includes session, search, cart, delivery, slot, checkout summary, and checkout readiness schemas.

Transport and storage ports are public so applications can provide their own HTTP, browser, and persistence adapters.

## Advanced Helpers

Request builders, parsers, normalizers, and low-level HTTP helpers are exported for deterministic tests and diagnostics. They are advanced API: they do not perform live I/O by themselves, but they may track Voila web-app endpoint drift more closely than the high-level operations.

No exported API places an order. Checkout APIs stop at read/review decisions and manual-checkout readiness.
