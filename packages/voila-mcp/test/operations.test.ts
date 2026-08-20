import {
  makeAuthenticatedSdkSessionSnapshot,
  connectionFailure,
  ProductUuidSchema,
  requestDeadlineExceeded,
  type SdkSessionSnapshot,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { StateFilePathSchema } from "@firfi/voila-session-store"
import { Effect, Result, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { authGuidanceForHealth, authGuidanceForSnapshot, makeAuthGuidance } from "../src/auth-guidance.js"
import { CartQuantitySchema } from "../src/operation-schemas.js"
import {
  makeSdkSessionForTest,
  makeSessionSnapshotForTest,
  makeStubEnvironment,
  runOperation,
  stubTransportLayer,
  unusedTransportLayer
} from "./helpers/operations.js"
import { makeNodeOperationEnvironment } from "../src/node-env.js"
import {
  mcpName,
  makeGuestSessionSnapshot,
  type OperationEnvironment,
  type OperationFailure,
  type SessionOperation,
  voilaOperationDescriptors,
  type VoilaOperationName,
  normalizeCliCartInput
} from "../src/operations.js"

const secretTimeoutMs = 30_000
const secretCookieValue = "voila-session=secret-cookie"
// the test owns an absolute path, so the brand is applied directly; production
// callers parse a configured path at the environment boundary
const sessionPath = StateFilePathSchema.make("/tmp/voila-session.json")

const completedOrdersResponse = JSON.stringify({
  data: {
    completedOrders: {
      edges: [
        {
          node: {
            orderId: "sanitized-order-id-1",
            prices: { total: { amount: "42.50", currency: "CAD" } },
            recurringOrderDefinition: null,
            region: { regionId: "sanitized-region-id", retailerRegionId: "sanitized-retailer-region-id" },
            slot: {
              __typename: "ImportedOrderSlot",
              end: "2026-05-15T14:00:00-04:00",
              name: "Imported order address",
              start: "2026-05-15T13:00:00-04:00",
              timeZone: "America/Montreal"
            },
            status: "DELIVERED"
          }
        }
      ],
      pageInfo: { endCursor: "sanitized-next-order-cursor", hasNextPage: true },
      retentionPeriod: "P1Y"
    }
  }
})

const discountedProductsResponse = JSON.stringify({
  productGroups: [
    {
      decoratedProducts: [
        {
          available: true,
          brand: "Sanitized Brand",
          maxQuantityReached: false,
          name: "Discounted milk",
          price: { amount: "5.00", currency: "CAD" },
          productId: "33333333-3333-4333-8333-333333333333",
          promoPrice: { amount: "4.00", currency: "CAD" },
          promotions: [{ label: "Member price", promotionId: "sanitized-promotion-id" }],
          quantityInBasket: 0,
          retailerProductId: "123456EA"
        }
      ],
      name: "Promotions",
      type: "promotion"
    }
  ]
})

const activeShoppingContextResponse = JSON.stringify({
  deliveryDestinationId: "sanitized-delivery-destination-id",
  deliveryMethod: "HOME_DELIVERY",
  regionId: "sanitized-region-id",
  type: "DELIVERY"
})

const invalidSlotOperationInputs: ReadonlyArray<readonly [VoilaOperationName, unknown]> = [
  ["voila_get_active_shopping_context", { regionId: "" }],
  ["voila_get_slot_listings", { deliveryDestinationId: "", regionId: "sanitized-region-id" }],
  [
    "voila_get_slot_listings",
    { deliveryDestinationId: "sanitized-delivery-destination-id", numberOfDays: 0, regionId: "sanitized-region-id" }
  ],
  [
    "voila_reserve_slot",
    {
      allowReservationOverwrite: true,
      confirmSlotReservation: true,
      deliveryDestinationId: "sanitized-delivery-destination-id",
      regionId: "",
      slotId: "sanitized-slot-id"
    }
  ],
  [
    "voila_reserve_slot",
    {
      confirmSlotReservation: true,
      deliveryDestinationId: "sanitized-delivery-destination-id",
      regionId: "sanitized-region-id",
      slotId: "sanitized-slot-id"
    }
  ],
  [
    "voila_reserve_slot",
    {
      allowReservationOverwrite: true,
      confirmSlotReservation: false,
      deliveryDestinationId: "sanitized-delivery-destination-id",
      regionId: "sanitized-region-id",
      slotId: "sanitized-slot-id"
    }
  ]
]

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`../../voila-sdk/test/fixtures/${name}`, import.meta.url), "utf8")

// a session port that records whether any operation ran against a session
const trackingSessionPort = (initialSession: SdkSessionSnapshot, ran: { current: boolean }) => ({
  withSession: <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> => {
    ran.current = true

    return Effect.map(operation(initialSession), (outcome) => outcome.value)
  },
  withAuthenticatedSession: <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> => {
    ran.current = true

    return Effect.map(operation(initialSession), (outcome) => outcome.value)
  }
})

describe("Voila MCP operations", () => {
  it("exposes the expected MCP server name and tool registry", () => {
    expect(mcpName).toBe("io.github.dearlordylord/voila-mcp")
    expect(voilaOperationDescriptors.map((operation) => operation.name)).toEqual([
      "voila_check_session_health",
      "voila_get_active_shopping_context",
      "voila_get_slot_listings",
      "voila_reserve_slot",
      "voila_search_products",
      "voila_get_category_products",
      "voila_get_discounted_products",
      "voila_get_completed_orders",
      "voila_get_order_details",
      "voila_get_completed_order_items",
      "voila_get_cart",
      "voila_add_cart_items",
      "voila_remove_cart_items"
    ])

    expect(
      voilaOperationDescriptors.find((operation) => operation.name === "voila_reserve_slot")?.description
    ).toContain("mutation")
    expect(
      voilaOperationDescriptors.find((operation) => operation.name === "voila_search_products")?.description
    ).toContain("prefer checking slots first")
    expect(
      voilaOperationDescriptors.find((operation) => operation.name === "voila_get_category_products")?.description
    ).toContain("prefer checking slots first")
    expect(
      voilaOperationDescriptors.find((operation) => operation.name === "voila_get_discounted_products")?.description
    ).toContain("prefer checking slots first")
  })

  it("only adds login guidance for guest or unhealthy account states", () => {
    const guidance = makeAuthGuidance()
    const guest = makeSdkSessionForTest()
    const authenticated = makeAuthenticatedSdkSessionSnapshot(makeSessionSnapshotForTest(), "authenticated")

    expect(Result.isSuccess(authenticated)).toBe(true)

    if (Result.isSuccess(authenticated)) {
      expect(authGuidanceForSnapshot(guidance, guest)).toEqual(guidance)
      expect(authGuidanceForSnapshot(guidance, authenticated.success)).toBeUndefined()
      expect(authGuidanceForHealth(guidance, { session: authenticated.success, status: "ok" })).toBeUndefined()
      expect(authGuidanceForHealth(guidance, { session: authenticated.success, status: "unauthorized" })).toEqual(
        guidance
      )
    }

    expect(authGuidanceForHealth(guidance, { session: guest, status: "ok" })).toEqual(guidance)
    expect(authGuidanceForHealth(guidance, { session: guest, status: "retry" })).toEqual(guidance)
  })

  it("validates input before loading a session", async () => {
    const ran = { current: false }
    const env: OperationEnvironment = {
      session: trackingSessionPort(makeSdkSessionForTest(), ran),
      transport: unusedTransportLayer
    }

    const result = await runOperation("voila_search_products", {}, env)

    expect(result.ok).toBe(false)
    expect(ran.current).toBe(false)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaOperationInputInvalid")
    }
  })

  it("runs a valid product search through the SDK operation", async () => {
    const response = await fixture("search-response-milk.json")
    const fake = makeStubEnvironment(() => Effect.succeed({ body: response, headers: {}, status: 200 }))

    const result = await runOperation("voila_search_products", { query: "milk" }, fake.env)

    expect(result.ok).toBe(true)
  })

  it("rejects invalid discounted product operation inputs before loading a session", async () => {
    for (const input of [
      { minSavingsAmount: -1 },
      { minSavingsPercent: -1 },
      { pageSize: 25 },
      { sort: "unsupported" }
    ]) {
      const ran = { current: false }
      const env: OperationEnvironment = {
        session: trackingSessionPort(makeSdkSessionForTest(), ran),
        transport: unusedTransportLayer
      }

      const result = await runOperation("voila_get_discounted_products", input, env)

      expect(result.ok).toBe(false)
      expect(ran.current).toBe(false)

      if (!result.ok) {
        expect(result.error._tag).toBe("VoilaOperationInputInvalid")
      }
    }
  })

  it("rejects invalid slot operation inputs before loading a session", async () => {
    for (const [name, input] of invalidSlotOperationInputs) {
      const ran = { current: false }
      const env: OperationEnvironment = {
        session: trackingSessionPort(makeSdkSessionForTest(), ran),
        transport: unusedTransportLayer
      }

      const result = await runOperation(name, input, env)

      expect(result.ok).toBe(false)
      expect(ran.current).toBe(false)

      if (!result.ok) {
        expect(result.error._tag).toBe("VoilaOperationInputInvalid")
      }
    }
  })

  it("bootstraps a guest session when no session file is configured", async () => {
    const homepage = await fixture("voila-homepage.html")
    const paths: Array<string> = []
    const env = makeNodeOperationEnvironment(
      {},
      stubTransportLayer((request) => {
        paths.push(request.url.pathname)

        return Effect.succeed({
          body: request.url.pathname === "/" ? homepage : JSON.stringify({ authenticated: false }),
          headers:
            request.url.pathname === "/"
              ? { "set-cookie": "voila-session=sanitized-cookie; Path=/; Secure; HttpOnly" }
              : {},
          status: 200
        })
      })
    )

    expect(Result.isSuccess(env)).toBe(true)

    if (Result.isSuccess(env)) {
      const result = await runOperation("voila_check_session_health", {}, env.success)

      expect(result.ok).toBe(true)
      // the first request is the homepage bootstrap of the in-memory guest session
      expect(paths[0]).toBe("/")
    }
  })

  it("redacts a guest bootstrap failure through the typed operation channel", async () => {
    const result = await Effect.runPromise(
      Effect.result(Effect.provide(makeGuestSessionSnapshot(), unusedTransportLayer))
    )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VoilaConnectionFailure")
      expect(result.failure.message).toBe("Voila request could not reach the server")
    }
  })

  it("updates an authenticated SDK snapshot after a successful operation", async () => {
    const cart = await fixture("cart-view-non-empty.json")
    const authenticated = makeAuthenticatedSdkSessionSnapshot(makeSessionSnapshotForTest(), "authenticated")

    expect(Result.isSuccess(authenticated)).toBe(true)
    if (Result.isFailure(authenticated)) {
      throw new Error("Expected an authenticated test session")
    }

    const env: OperationEnvironment = {
      session: {
        withSession: <A>(operation: SessionOperation<A>): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.map(operation(authenticated.success), (outcome) => outcome.value),
        withAuthenticatedSession: <A>(
          operation: SessionOperation<A>
        ): Effect.Effect<A, OperationFailure, VoilaTransport> =>
          Effect.map(operation(authenticated.success), (outcome) => outcome.value)
      },
      transport: stubTransportLayer(() => Effect.succeed({ body: cart, headers: {}, status: 200 }))
    }

    const result = await runOperation("voila_get_cart", {}, env)

    expect(result.ok).toBe(true)
  })

  it("returns CLI login guidance for guest session health", async () => {
    const fake = makeStubEnvironment(() =>
      Effect.succeed({ body: JSON.stringify({ authenticated: false }), headers: {}, status: 200 })
    )
    const env: OperationEnvironment = { ...fake.env, authGuidance: makeAuthGuidance(sessionPath) }
    const result = await runOperation("voila_check_session_health", {}, env)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.authGuidance?.mcpEnv.VOILA_AUTH_SESSION_PATH).toBe(sessionPath)
      expect(result.authGuidance?.instructions).toContain("close the browser window")
    }
  })

  it("reports the health retry reason when Voila returns a server error", async () => {
    const fake = makeStubEnvironment(() => Effect.succeed({ body: "{}", headers: {}, status: 503 }))

    const result = await runOperation("voila_check_session_health", {}, fake.env)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatchObject({ reason: "server", status: "retry" })
    }
  })

  it("returns CLI login guidance when the session cycle fails", async () => {
    const env: OperationEnvironment = {
      authGuidance: makeAuthGuidance(sessionPath),
      session: {
        withSession: () =>
          Effect.fail({ _tag: "SessionFileReadFailure", message: "Session snapshot could not be read" }),
        withAuthenticatedSession: () =>
          Effect.fail({ _tag: "SessionFileReadFailure", message: "Session snapshot could not be read" })
      },
      transport: unusedTransportLayer
    }

    const result = await runOperation("voila_get_cart", {}, env)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.error.authGuidance?.instructions).toContain("retry the MCP request")
    }
  })

  it("reports a typed health-check failure without leaking its detail", async () => {
    const fake = makeStubEnvironment(() => Effect.succeed({ body: "{}", headers: {}, status: 200 }))
    const env: OperationEnvironment = {
      ...fake.env,
      health: {
        check: () =>
          Effect.fail({
            _tag: "SessionHealthSnapshotInvalid",
            message: "Session health could not build a typed SDK session snapshot"
          })
      }
    }

    const result = await runOperation("voila_check_session_health", {}, env)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error._tag).toBe("SessionHealthSnapshotInvalid")
      expect(result.error.message).toBe("Session health could not build a typed SDK session snapshot")
      expect(JSON.stringify(result)).not.toContain("private snapshot detail")
    }
  })

  it("returns normalized cart mutation data and persists the updated session", async () => {
    const cartApply = await fixture("cart-apply-success.json")
    const fake = makeStubEnvironment(() => Effect.succeed({ body: cartApply, headers: {}, status: 200 }))

    const result = await runOperation(
      "voila_add_cart_items",
      { items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }] },
      fake.env
    )

    expect(result.ok).toBe(true)
    expect(fake.saved()?.kind).toBe("guest")

    if (result.ok) {
      expect(result.value).toMatchObject({
        itemCount: 2,
        limitedItems: [],
        pricingNotifications: [{ code: "PROMO_APPLIED" }],
        unavailableData: []
      })
    }
  })

  it("returns paginated completed orders", async () => {
    const fake = makeStubEnvironment(() => Effect.succeed({ body: completedOrdersResponse, headers: {}, status: 200 }))

    const result = await runOperation(
      "voila_get_completed_orders",
      { pageSize: 2, pageToken: "previous-cursor" },
      fake.env
    )

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toMatchObject({
        pagination: { hasNextPage: true, nextPageToken: "sanitized-next-order-cursor" }
      })
      expect(result.value).toHaveProperty("orders")
      expect(JSON.stringify(result.value)).toContain("sanitized-order-id-1")
    }
  })

  it("returns normalized discounted products through the SDK registry path", async () => {
    const paths: Array<string> = []
    const fake = makeStubEnvironment((request) => {
      paths.push(request.url.pathname)

      return Effect.succeed({ body: discountedProductsResponse, headers: {}, status: 200 })
    })

    const result = await runOperation(
      "voila_get_discounted_products",
      { minSavingsPercent: 15, pageSize: 3, query: "milk", sort: "best-percent" },
      fake.env
    )

    expect(result.ok).toBe(true)
    expect(paths).toEqual(["/api/product-listing-pages/v1/pages/promotions"])

    if (result.ok) {
      expect(result.value).toMatchObject({
        products: [
          {
            discountPrice: { amount: "4.00" },
            productId: "33333333-3333-4333-8333-333333333333",
            promotionSummary: "Member price",
            savingsAmount: 1,
            savingsPercent: 20
          }
        ],
        scan: { pagesScanned: 1 }
      })
    }
  })

  it("dispatches category reads, cart removals, and branded CLI quantities", async () => {
    const categoryProducts = await fixture("category-products-produce.json")
    const category = makeStubEnvironment(() => Effect.succeed({ body: categoryProducts, headers: {}, status: 200 }))
    const categoryResult = await runOperation(
      "voila_get_category_products",
      { categoryId: "sanitized-category-produce" },
      category.env
    )

    const cartApply = await fixture("cart-apply-success.json")
    const removal = makeStubEnvironment(() => Effect.succeed({ body: cartApply, headers: {}, status: 200 }))
    const removalResult = await runOperation(
      "voila_remove_cart_items",
      { items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }] },
      removal.env
    )
    const quantity = Schema.decodeUnknownSync(CartQuantitySchema)(2)
    const normalized = normalizeCliCartInput(ProductUuidSchema.make("11111111-1111-4111-8111-111111111111"), quantity)

    expect(categoryResult.ok).toBe(true)
    expect(removalResult.ok).toBe(true)
    expect(normalized).toEqual({ items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 2 }] })
  })

  it("returns active shopping context through the SDK path and persists the updated session", async () => {
    const paths: Array<string> = []
    const fake = makeStubEnvironment((request) => {
      paths.push(`${request.url.pathname}${request.url.search}`)

      return Effect.succeed({ body: activeShoppingContextResponse, headers: {}, status: 200 })
    })

    const result = await runOperation(
      "voila_get_active_shopping_context",
      { regionId: "sanitized-region-id" },
      fake.env
    )

    expect(result.ok).toBe(true)
    expect(fake.saved()?.kind).toBe("guest")
    expect(paths).toEqual(["/api/customersessions/v2/sessions/active?regionId=sanitized-region-id"])

    if (result.ok) {
      expect(result.value).toMatchObject({
        deliveryDestinationId: "sanitized-delivery-destination-id",
        deliveryMethod: "HOME_DELIVERY",
        regionId: "sanitized-region-id"
      })
    }
  })

  it("returns slot listings without hitting reservation endpoints", async () => {
    const slotListing = await fixture("slot-listing-available.json")
    const requests: Array<{ readonly body?: string; readonly pathname: string }> = []
    const fake = makeStubEnvironment((request) => {
      requests.push({ ...("body" in request ? { body: request.body } : {}), pathname: request.url.pathname })

      return Effect.succeed({ body: slotListing, headers: {}, status: 200 })
    })

    const result = await runOperation(
      "voila_get_slot_listings",
      { deliveryDestinationId: "sanitized-delivery-destination-id", regionId: "sanitized-region-id" },
      fake.env
    )

    expect(result.ok).toBe(true)
    expect(requests.map((request) => request.pathname)).toEqual(["/api/ecomslots/v2/slots"])
    expect(requests[0]?.pathname).not.toContain("reservation")
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      deliveryDestinationId: "sanitized-delivery-destination-id",
      displayConfiguration: "DELIVERY_METHOD",
      numberOfDays: 7,
      regionId: "sanitized-region-id",
      shippingGroupType: "HOME_DELIVERY"
    })

    if (result.ok) {
      expect(result.value).toMatchObject({ availableSlotCount: 2 })
    }
  })

  it("reserves a slot only with explicit confirmation flags", async () => {
    const slotReservation = await fixture("slot-reservation-success.json")
    const requests: Array<{ readonly body?: string; readonly pathname: string }> = []
    const fake = makeStubEnvironment((request) => {
      requests.push({ ...("body" in request ? { body: request.body } : {}), pathname: request.url.pathname })

      return Effect.succeed({ body: slotReservation, headers: {}, status: 200 })
    })

    const result = await runOperation(
      "voila_reserve_slot",
      {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "sanitized-delivery-destination-id",
        regionId: "sanitized-region-id",
        slotId: "sanitized-slot-id"
      },
      fake.env
    )

    expect(result.ok).toBe(true)
    expect(requests.map((request) => request.pathname)).toEqual(["/api/ecomslots/v1/slots/reservation"])
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      deliveryDestinationId: "sanitized-delivery-destination-id",
      regionId: "sanitized-region-id",
      slotId: "sanitized-slot-id"
    })

    if (result.ok) {
      expect(result.value).toMatchObject({ reserved: true, slotId: "sanitized-slot-id" })
    }
  })

  it("returns CLI login guidance for completed order GraphQL failures", async () => {
    const fake = makeStubEnvironment(() =>
      Effect.succeed({
        body: JSON.stringify({ errors: [{ message: "secret-account-required-detail" }] }),
        headers: {},
        status: 200
      })
    )
    const env: OperationEnvironment = { ...fake.env, authGuidance: makeAuthGuidance(sessionPath) }

    const result = await runOperation("voila_get_completed_orders", {}, env)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain("secret-account-required-detail")

    if (!result.ok) {
      expect(result.error._tag).toBe("CompletedOrdersGraphqlError")
      expect(result.error.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.error.authGuidance?.instructions).toContain("retry the MCP request")
    }
  })

  it("redacts transport failures and keeps their tags distinguishable", async () => {
    const refused = makeStubEnvironment(() => Effect.fail(connectionFailure()))
    const abandoned = makeStubEnvironment(() => Effect.fail(requestDeadlineExceeded(secretTimeoutMs)))

    const refusedResult = await runOperation("voila_get_cart", {}, refused.env)
    const abandonedResult = await runOperation("voila_get_cart", {}, abandoned.env)

    expect(refusedResult.ok).toBe(false)
    expect(abandonedResult.ok).toBe(false)

    if (!refusedResult.ok && !abandonedResult.ok) {
      expect(refusedResult.error._tag).toBe("VoilaConnectionFailure")
      expect(abandonedResult.error._tag).toBe("VoilaRequestDeadlineExceeded")
      // the redacted failure keeps the tag and message, and nothing else
      expect(Object.keys(abandonedResult.error).sort()).toEqual(["_tag", "message"])
    }
  })

  it("reports a thrown transport failure without rendering what was thrown", async () => {
    const thrown = makeStubEnvironment(() => {
      throw new Error(`cookie ${secretCookieValue}`)
    })

    const result = await runOperation("voila_get_cart", {}, thrown.env)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaOperationFailed")
      expect(JSON.stringify(result)).not.toContain(secretCookieValue)
    }
  })
})
