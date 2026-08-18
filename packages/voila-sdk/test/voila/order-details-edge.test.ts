import { Effect, Result } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  getCompletedOrderItems,
  getOrderDetails,
  makeSessionSnapshot,
  normalizeOrderDetailsResponse,
  parseUnknown,
  RawDecoratedOrderResponseSchema,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import { respondingTransport, runWith, type StubTransport, stubTransport } from "../helpers/transport.js"

const csrfToken = "csrf-token"
const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const makeSession = (): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.success)

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.success
}

const okResponse = (body: unknown): VoilaTransportResponse => ({ body: JSON.stringify(body), headers: {}, status: 200 })

const deliveryEndFor = (orderId: string): string => {
  switch (orderId) {
    case "order-b":
      return "2026-06-01T10:00:00-04:00"
    case "old-order":
      return "2026-04-10T10:00:00-04:00"
    case "short-date-order":
      return "bad"
    default:
      return "2026-06-10T10:00:00-04:00"
  }
}

const completedOrders = (orderIds: ReadonlyArray<string> = ["order-a", "order-b"]) => ({
  data: {
    completedOrders: {
      edges: orderIds.map((orderId) => ({
        node: {
          orderId,
          prices: { total: { amount: "10.00", currency: "CAD" } },
          recurringOrderDefinition: null,
          region: { regionId: "region-id", retailerRegionId: "retailer-region-id" },
          slot: {
            __typename: "ImportedOrderSlot",
            end: deliveryEndFor(orderId),
            name: "Home",
            start: "2026-06-10T09:00:00-04:00",
            timeZone: "America/Montreal"
          },
          status: "DELIVERED"
        }
      })),
      pageInfo: { endCursor: "next-page", hasNextPage: true }
    }
  }
})

const completedOrdersPage = (orderIds: ReadonlyArray<string>, hasNextPage: boolean, nextPageToken: string | null) => ({
  data: {
    completedOrders: {
      edges: completedOrders(orderIds).data.completedOrders.edges,
      pageInfo: { endCursor: nextPageToken, hasNextPage }
    }
  }
})

const sparseDecoratedOrder = {
  entities: {
    order: {
      fallbackOrder: {
        items: [
          {
            price: { amount: "1.20", currency: "CAD" },
            product: {
              name: "Inline pears",
              productId: "inline-pears",
              retailerProductId: "retailer-inline-pears",
              sellerId: "seller-inline",
              sellerName: "Inline Seller"
            },
            sample: true
          },
          { productId: "fallback-product", quantity: 1, totalPrice: { amount: "not-a-decimal", currency: "CAD" } }
        ],
        itemsOnCheckout: [{ productId: "risk-product" }],
        orderId: "fallbackOrder",
        returnedItems: [{ productId: "returned-product" }],
        slot: { end: "2026-06-10T10:00:00-04:00" },
        substitutedItems: [{ productId: "requested-product" }]
      }
    }
  }
}

const decoratedOrderFor = (orderId: string) => ({
  entities: {
    order: {
      [orderId]: {
        items:
          orderId === "order-b"
            ? [
                { productId: "product-a", quantity: 1, totalPrice: { amount: "3", currency: "CAD" } },
                {
                  product: { name: "Retailer-only item", retailerProductId: "retailer-only" },
                  quantity: 1,
                  totalPrice: { amount: "2.5", currency: "CAD" }
                },
                { product: { name: "Name-only item" }, quantity: 1 },
                { quantity: 1, totalPrice: { amount: "not-a-decimal", currency: "CAD" } }
              ]
            : [
                { product: "product-b", quantity: 1, totalPrice: { amount: "2.00", currency: "CAD" } },
                { product: "product-a", quantity: 1, totalPrice: { amount: "3.00", currency: "CAD" } }
              ],
        orderId
      }
    },
    product: {
      "product-a": { brand: "Brand A", name: "Apples", productId: "product-a" },
      "product-b": { brand: "Brand B", name: "Bananas", productId: "product-b" }
    }
  }
})

const makeRoutingTransport = (): StubTransport =>
  stubTransport((request) =>
    Effect.succeed(
      request.url.pathname === "/graphql"
        ? okResponse(completedOrders())
        : okResponse(decoratedOrderFor(request.url.pathname.includes("order-b") ? "order-b" : "order-a"))
    )
  )

describe("order detail edge cases", () => {
  it("normalizes sparse decorated order details and fallback order maps", () => {
    const parsed = parseUnknown(RawDecoratedOrderResponseSchema, sparseDecoratedOrder)

    expect(Result.isSuccess(parsed)).toBe(true)

    if (Result.isSuccess(parsed)) {
      const result = normalizeOrderDetailsResponse(parsed.success, "requested-order-id")

      expect(Result.isSuccess(result)).toBe(true)

      if (Result.isSuccess(result)) {
        expect(result.success.dates).toEqual({ deliveryEndDate: "2026-06-10T10:00:00-04:00" })
        expect(result.success).not.toHaveProperty("status")
        expect(result.success.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              groupKind: "received",
              name: "Inline pears",
              quantity: 1,
              sample: true,
              sellerId: "seller-inline",
              unitPrice: { amount: "1.20", currency: "CAD" }
            }),
            expect.objectContaining({ groupKind: "returned", productId: "returned-product" }),
            expect.objectContaining({ groupKind: "atRisk", productId: "risk-product" }),
            expect.objectContaining({
              groupKind: "substituted",
              productId: "requested-product",
              substitutionRole: "requested"
            })
          ])
        )
      }
    }
  })

  it("returns typed failures for invalid and unavailable order details", async () => {
    const invalid = await runWith(getOrderDetails(makeSession(), {}), makeRoutingTransport())

    expect(Result.isFailure(invalid)).toBe(true)

    if (Result.isFailure(invalid)) {
      expect(invalid.failure._tag).toBe("OrderDetailsInputInvalid")
    }

    const parsed = parseUnknown(RawDecoratedOrderResponseSchema, { entities: { order: {} } })

    expect(Result.isSuccess(parsed)).toBe(true)

    if (Result.isSuccess(parsed)) {
      const unavailable = normalizeOrderDetailsResponse(parsed.success, "missing-order")

      expect(Result.isFailure(unavailable)).toBe(true)

      if (Result.isFailure(unavailable)) {
        expect(unavailable.failure._tag).toBe("OrderDetailsUnavailable")
      }
    }
  })

  it("normalizes partial slot date fields", () => {
    const parsed = parseUnknown(RawDecoratedOrderResponseSchema, {
      entities: {
        order: {
          partialSlotOrder: {
            orderId: "partialSlotOrder",
            slot: { start: "2026-06-10T09:00:00-04:00", timeZone: "America/Montreal" }
          }
        }
      }
    })

    expect(Result.isSuccess(parsed)).toBe(true)

    if (Result.isSuccess(parsed)) {
      const result = normalizeOrderDetailsResponse(parsed.success, "partialSlotOrder")

      expect(Result.isSuccess(result)).toBe(true)

      if (Result.isSuccess(result)) {
        expect(result.success.dates).toEqual({
          deliveryStartDate: "2026-06-10T09:00:00-04:00",
          timeZoneId: "America/Montreal"
        })
      }
    }
  })

  it("aggregates and sorts multiple completed order items", async () => {
    const result = await runWith(
      getCompletedOrderItems(makeSession(), {
        fromDate: "2026-06-01",
        maxOrders: 2,
        pageSize: 2,
        pageToken: "cursor",
        toDate: "2026-06-30"
      }),
      makeRoutingTransport()
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.value.items[0]).toMatchObject({
        itemKey: "product-a",
        lastOrderId: "order-a",
        lastOrderedAt: "2026-06-10T10:00:00-04:00",
        orderCount: 2,
        totalQuantity: 2,
        totalSpend: { amount: "6.00", currency: "CAD" }
      })
      expect(result.success.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemKey: "Name-only item", orderCount: 1, totalQuantity: 1 }),
          expect.objectContaining({
            itemKey: "retailer-only",
            orderCount: 1,
            retailerProductId: "retailer-only",
            totalQuantity: 1,
            totalSpend: { amount: "2.50", currency: "CAD" }
          }),
          expect.objectContaining({ itemKey: "unknown-product", orderCount: 1, totalQuantity: 1 }),
          expect.objectContaining({
            itemKey: "product-b",
            orderCount: 1,
            totalQuantity: 1,
            totalSpend: { amount: "2.00", currency: "CAD" }
          })
        ])
      )
    }
  })

  it("returns empty aggregate results when no orders match the date range", async () => {
    const transport = respondingTransport(
      okResponse(completedOrdersPage(["old-order", "short-date-order"], false, null))
    )
    const result = await runWith(
      getCompletedOrderItems(makeSession(), { fromDate: "2026-06-01", toDate: "2026-06-30" }),
      transport
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(result.success.value).toMatchObject({ itemCount: 0, items: [], ordersMatched: 0, ordersScanned: 2 })
    }
  })

  it("scans completed order pages until enough date-range matches are found", async () => {
    const requests: Array<string | null> = []
    const transport = stubTransport((request) => {
      if (request.url.pathname !== "/graphql") {
        return Effect.succeed(
          okResponse(decoratedOrderFor(request.url.pathname.includes("order-b") ? "order-b" : "order-a"))
        )
      }

      const body = request.body ?? ""
      requests.push(body.includes("page-2") ? "page-2" : null)

      return Effect.succeed(
        okResponse(
          body.includes("page-2")
            ? completedOrdersPage(["order-b"], false, null)
            : completedOrdersPage(["old-order"], true, "page-2")
        )
      )
    })
    const result = await runWith(
      getCompletedOrderItems(makeSession(), {
        fromDate: "2026-06-01",
        maxOrders: 1,
        pageSize: 1,
        toDate: "2026-06-30"
      }),
      transport
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      expect(requests).toEqual([null, "page-2"])
      expect(result.success.value).toMatchObject({ ordersMatched: 1, ordersScanned: 2 })
      expect(result.success.value.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemKey: "product-a" })])
      )
    }
  })

  it("caps completed order page size to remaining aggregate capacity", async () => {
    const graphqlBodies: Array<string> = []
    const transport = stubTransport((request) => {
      if (request.url.pathname === "/graphql") {
        graphqlBodies.push(request.body ?? "")

        return Effect.succeed(okResponse(completedOrdersPage(["order-a"], true, "page-2")))
      }

      return Effect.succeed(okResponse(decoratedOrderFor("order-a")))
    })
    const result = await runWith(getCompletedOrderItems(makeSession(), { maxOrders: 1, pageSize: 5 }), transport)

    expect(Result.isSuccess(result)).toBe(true)
    expect(graphqlBodies).toHaveLength(1)
    expect(graphqlBodies[0]).toContain('"first":1')
  })

  it("returns typed failures for invalid aggregate input and upstream failures", async () => {
    const invalid = await runWith(getCompletedOrderItems(makeSession(), { maxOrders: 0 }), makeRoutingTransport())

    expect(Result.isFailure(invalid)).toBe(true)

    if (Result.isFailure(invalid)) {
      expect(invalid.failure._tag).toBe("CompletedOrderItemsInputInvalid")
    }

    const graphqlFailure = await runWith(
      getCompletedOrderItems(makeSession(), {}),
      respondingTransport(okResponse({ errors: [{ message: "auth required" }] }))
    )

    expect(Result.isFailure(graphqlFailure)).toBe(true)

    if (Result.isFailure(graphqlFailure)) {
      expect(graphqlFailure.failure._tag).toBe("CompletedOrdersGraphqlError")
    }

    const detailFailure = await runWith(
      getCompletedOrderItems(makeSession(), { fromDate: "2026-06-01", toDate: "2026-06-30" }),
      stubTransport((request) =>
        Effect.succeed(
          request.url.pathname === "/graphql"
            ? okResponse(completedOrders(["order-a"]))
            : okResponse({ entities: { order: {} } })
        )
      )
    )

    expect(Result.isFailure(detailFailure)).toBe(true)

    if (Result.isFailure(detailFailure)) {
      expect(detailFailure.failure._tag).toBe("OrderDetailsUnavailable")
    }
  })
})
