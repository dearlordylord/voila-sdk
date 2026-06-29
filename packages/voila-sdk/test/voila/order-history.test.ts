import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  getCompletedOrders,
  makeSessionSnapshot,
  normalizeCompletedOrdersResponse,
  parseUnknown,
  RawCompletedOrdersGraphqlResponseSchema,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const completedOrdersResponse = {
  data: {
    completedOrders: {
      edges: [
        {
          node: {
            orderId: "sanitized-order-id-1",
            prices: {
              total: {
                amount: "42.50",
                currency: "CAD"
              }
            },
            recurringOrderDefinition: {
              name: "Weekly staples"
            },
            region: {
              regionId: "sanitized-region-id",
              retailerRegionId: "sanitized-retailer-region-id"
            },
            slot: {
              __typename: "InternalOrderSlot",
              carrier: {
                carrierId: "sanitized-carrier-id"
              },
              deliveryDestination: {
                address: {
                  timeZone: "America/Montreal"
                },
                deliveryMethod: "HOME_DELIVERY",
                name: "Home"
              },
              end: "2026-06-20T11:00:00-04:00",
              externalLocker: null,
              shippingGroupType: "HOME_DELIVERY",
              start: "2026-06-20T10:00:00-04:00",
              type: "STANDARD"
            },
            status: "DELIVERED"
          }
        },
        {
          node: {
            orderId: "sanitized-order-id-2",
            prices: {
              total: {
                amount: "18.20",
                currency: "CAD"
              }
            },
            recurringOrderDefinition: null,
            region: {
              regionId: "sanitized-region-id",
              retailerRegionId: "sanitized-retailer-region-id"
            },
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
      pageInfo: {
        endCursor: "sanitized-next-order-cursor",
        hasNextPage: true
      },
      retentionPeriod: "ONE_YEAR"
    }
  }
}
const fixtureText = JSON.stringify(completedOrdersResponse)
const csrfToken = "csrf-token"
const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const makeSession = (token: string = csrfToken): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=before; Path=/; Secure", VOILA_BASE_URL)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.right)

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.right
}

const makeResponseTransport = (response: VoilaTransportResponse): {
  readonly requests: () => ReadonlyArray<VoilaTransportRequest>
  readonly transport: VoilaTransport
} => {
  const requests: Array<VoilaTransportRequest> = []

  return {
    requests: () => requests,
    transport: {
      request: async (request) => {
        requests.push(request)
        return Either.right(response)
      }
    }
  }
}

const makeCompletedOrdersResponse = (
  body: string = fixtureText,
  status: number = 200
): VoilaTransportResponse => ({
  body,
  headers: {
    "set-cookie": "fresh-order-cookie=after; Path=/; Secure"
  },
  status
})

describe("completed order history", () => {
  it("normalizes completed order GraphQL responses", () => {
    const parsed = parseUnknown(RawCompletedOrdersGraphqlResponseSchema, JSON.parse(fixtureText))

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const result = normalizeCompletedOrdersResponse(parsed.right)

      expect(result.pagination).toEqual({
        hasNextPage: true,
        nextPageToken: "sanitized-next-order-cursor",
        retentionPeriod: "ONE_YEAR"
      })
      expect(result.orders[0]).toMatchObject({
        addressNickName: "Home",
        carrierId: "sanitized-carrier-id",
        deliveryMethod: "HOME_DELIVERY",
        orderId: "sanitized-order-id-1",
        orderTotals: {
          totalPrice: {
            amount: "42.50",
            currency: "CAD"
          }
        },
        recurringShoppingDefinition: {
          name: "Weekly staples"
        },
        slotType: "STANDARD",
        status: "DELIVERED"
      })
      expect(result.orders[1]).toMatchObject({
        addressNickName: "Imported order address",
        deliveryMethod: "HOME_DELIVERY",
        orderId: "sanitized-order-id-2",
        slotType: "STANDARD"
      })
    }
  })

  it("omits absent optional completed order fields", () => {
    const parsed = parseUnknown(RawCompletedOrdersGraphqlResponseSchema, {
      data: {
        completedOrders: {
          edges: [
            null,
            {
              node: null
            },
            {
              node: {
                orderId: "sanitized-order-id-3",
                prices: {
                  total: {
                    amount: "9.99",
                    currency: "CAD"
                  }
                },
                region: {
                  regionId: "sanitized-region-id",
                  retailerRegionId: "sanitized-retailer-region-id"
                },
                slot: {
                  __typename: "InternalOrderSlot",
                  carrier: null,
                  deliveryDestination: {
                    address: {
                      timeZone: "America/Toronto"
                    },
                    deliveryMethod: "CUSTOMER_COLLECTION",
                    name: "Pickup"
                  },
                  end: "2026-04-10T12:00:00-04:00",
                  externalLocker: {
                    externalLockerId: "sanitized-locker-id"
                  },
                  start: "2026-04-10T11:00:00-04:00",
                  type: "STANDARD"
                },
                status: "COLLECTED"
              }
            }
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    })

    expect(Either.isRight(parsed)).toBe(true)

    if (Either.isRight(parsed)) {
      const result = normalizeCompletedOrdersResponse(parsed.right)

      expect(result.orders).toHaveLength(1)
      expect(result.orders[0]).toMatchObject({
        externalAddress: {
          externalCollectionPointId: "sanitized-locker-id"
        },
        orderId: "sanitized-order-id-3"
      })
      expect(result.orders[0]).not.toHaveProperty("carrierId")
      expect(result.orders[0]).not.toHaveProperty("recurringShoppingDefinition")
      expect(result.orders[0]).not.toHaveProperty("shippingGroupType")
      expect(result.pagination).toEqual({
        hasNextPage: false
      })
    }
  })

  it("fetches completed orders through the active session and persists cookies", async () => {
    const fake = makeResponseTransport(makeCompletedOrdersResponse())
    const result = await getCompletedOrders(makeSession(), {
      pageSize: 2,
      pageToken: "previous-cursor"
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("POST")
      expect(request?.url.pathname).toBe("/graphql")
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
        operationName: "GetCompletedOrders",
        variables: {
          after: "previous-cursor",
          first: 2
        }
      })
      expect(result.right.value.orders).toHaveLength(2)
      expect(result.right.value.pagination.nextPageToken).toBe("sanitized-next-order-cursor")
    }
  })

  it("rejects invalid completed order inputs before network I/O", async () => {
    const fake = makeResponseTransport(makeCompletedOrdersResponse())
    const result = await getCompletedOrders(makeSession(), {
      pageSize: 0
    }, fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CompletedOrdersInputInvalid")
    }
  })

  it("propagates HTTP client errors as typed recoverable errors", async () => {
    const result = await getCompletedOrders(
      makeSession(" "),
      {},
      makeResponseTransport(
        makeCompletedOrdersResponse()
      ).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })
})
