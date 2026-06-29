import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
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

const csrfToken = "csrf-token"
const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const completedOrdersResponse = {
  data: {
    completedOrders: {
      edges: [
        {
          node: {
            orderId: "sanitized-order-id-1",
            prices: {
              total: {
                amount: "44.00",
                currency: "CAD"
              }
            },
            recurringOrderDefinition: null,
            region: {
              regionId: "region-id",
              retailerRegionId: "retailer-region-id"
            },
            slot: {
              __typename: "ImportedOrderSlot",
              end: "2026-06-15T10:00:00-04:00",
              name: "Home",
              start: "2026-06-15T09:00:00-04:00",
              timeZone: "America/Montreal"
            },
            status: "DELIVERED"
          }
        },
        {
          node: {
            orderId: "sanitized-order-id-2",
            prices: {
              total: {
                amount: "12.00",
                currency: "CAD"
              }
            },
            recurringOrderDefinition: null,
            region: {
              regionId: "region-id",
              retailerRegionId: "retailer-region-id"
            },
            slot: {
              __typename: "ImportedOrderSlot",
              end: "2026-05-01T10:00:00-04:00",
              name: "Home",
              start: "2026-05-01T09:00:00-04:00",
              timeZone: "America/Montreal"
            },
            status: "DELIVERED"
          }
        }
      ],
      pageInfo: {
        endCursor: null,
        hasNextPage: false
      },
      retentionPeriod: "P1Y"
    }
  }
}

const decoratedOrderResponse = {
  entities: {
    order: {
      "sanitized-order-id-1": {
        items: [{
          finalPrice: {
            amount: "9.98",
            currency: "CAD"
          },
          product: "product-1",
          quantity: 2
        }],
        missingItems: [{
          product: "product-2",
          quantity: 1
        }],
        orderId: "sanitized-order-id-1",
        orderReference: "reference-1",
        prices: {
          total: {
            amount: "44.00",
            currency: "CAD"
          }
        },
        region: {
          regionId: "region-id",
          retailerRegionId: "retailer-region-id"
        },
        slot: {
          end: "2026-06-15T10:00:00-04:00",
          start: "2026-06-15T09:00:00-04:00",
          timeZone: "America/Montreal"
        },
        status: "DELIVERED",
        substitutedItems: [{
          product: "product-3",
          quantity: 1,
          substitutes: [{
            product: "product-4",
            quantity: 1
          }]
        }]
      }
    },
    product: {
      "product-1": {
        brand: "Voila",
        isInCurrentCatalog: true,
        name: "Milk",
        price: {
          current: {
            amount: "4.99",
            currency: "CAD"
          }
        },
        productId: "product-1",
        retailerProductId: "retailer-product-1",
        seller: {
          id: "seller-1",
          name: "Voila"
        }
      },
      "product-2": {
        name: "Unavailable bread",
        productId: "product-2"
      },
      "product-3": {
        name: "Requested apples",
        productId: "product-3"
      },
      "product-4": {
        name: "Substitute apples",
        productId: "product-4"
      }
    }
  }
}

const makeSession = (): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

const response = (body: unknown): VoilaTransportResponse => ({
  body: JSON.stringify(body),
  headers: {
    "set-cookie": "fresh-order-cookie=after; Path=/; Secure"
  },
  status: 200
})

const makeTransport = (): {
  readonly requests: () => ReadonlyArray<VoilaTransportRequest>
  readonly transport: VoilaTransport
} => {
  const requests: Array<VoilaTransportRequest> = []

  return {
    requests: () => requests,
    transport: {
      request: async (request) => {
        requests.push(request)

        return Either.right(
          request.url.pathname === "/graphql"
            ? response(completedOrdersResponse)
            : response(decoratedOrderResponse)
        )
      }
    }
  }
}

describe("order details", () => {
  it("normalizes decorated order item groups", () => {
    const parsed = parseUnknown(RawDecoratedOrderResponseSchema, decoratedOrderResponse)

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const result = normalizeOrderDetailsResponse(parsed.right, "sanitized-order-id-1")

      expect(Either.isRight(result)).toBe(true)

      if (Either.isRight(result)) {
        expect(result.right.items).toEqual(expect.arrayContaining([
          expect.objectContaining({
            groupKind: "received",
            name: "Milk",
            productId: "product-1",
            quantity: 2,
            totalPrice: {
              amount: "9.98",
              currency: "CAD"
            },
            unitPrice: {
              amount: "4.99",
              currency: "CAD"
            }
          }),
          expect.objectContaining({
            groupKind: "missing",
            name: "Unavailable bread"
          }),
          expect.objectContaining({
            groupKind: "substituted",
            name: "Substitute apples",
            substitutionForProductId: "product-3",
            substitutionRole: "substitute"
          })
        ]))
      }
    }
  })

  it("fetches decorated order details through the active session", async () => {
    const fake = makeTransport()
    const result = await getOrderDetails(makeSession(), {
      orderId: "sanitized-order-id-1"
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/order/v6/orders/sanitized-order-id-1/decorated")
      expect(result.right.value).toMatchObject({
        orderId: "sanitized-order-id-1",
        orderReference: "reference-1",
        status: "DELIVERED"
      })
    }
  })

  it("aggregates received items from completed orders in a date range", async () => {
    const fake = makeTransport()
    const result = await getCompletedOrderItems(makeSession(), {
      fromDate: "2026-06-01",
      maxOrders: 10,
      pageSize: 2,
      toDate: "2026-06-30"
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.value).toMatchObject({
        itemCount: 1,
        items: [{
          itemKey: "product-1",
          lastOrderId: "sanitized-order-id-1",
          name: "Milk",
          orderCount: 1,
          productId: "product-1",
          totalQuantity: 2,
          totalSpend: {
            amount: "9.98",
            currency: "CAD"
          }
        }],
        ordersMatched: 1,
        ordersScanned: 2
      })
      expect(fake.requests().map((request) => request.url.pathname)).toEqual([
        "/graphql",
        "/api/order/v6/orders/sanitized-order-id-1/decorated"
      ])
    }
  })
})
