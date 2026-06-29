import {
  makeGuestSdkSessionSnapshot,
  makeSessionSnapshot,
  type SdkSessionSnapshot,
  serializeCookieJar,
  type SessionSnapshot,
  toughCookieJarPort,
  type VoilaTransport
} from "@firfi/voila-sdk"
import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { type OperationEnvironment, runVoilaOperation } from "../src/operations.js"

const voilaUrl = "https://voila.ca/"
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
      edges: [{
        node: {
          orderId: "sanitized-order-id-1",
          prices: {
            total: {
              amount: "10.00",
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
            end: "2026-06-10T10:00:00-04:00",
            name: "Home",
            start: "2026-06-10T09:00:00-04:00",
            timeZone: "America/Montreal"
          },
          status: "DELIVERED"
        }
      }],
      pageInfo: {
        endCursor: null,
        hasNextPage: false
      }
    }
  }
}

const decoratedOrderResponse = {
  entities: {
    order: {
      "sanitized-order-id-1": {
        items: [{
          product: "product-1",
          quantity: 3,
          totalPrice: {
            amount: "7.50",
            currency: "CAD"
          }
        }],
        orderId: "sanitized-order-id-1",
        status: "DELIVERED"
      }
    },
    product: {
      "product-1": {
        name: "Bananas",
        productId: "product-1",
        retailerProductId: "retailer-product-1"
      }
    }
  }
}

const makeSessionSnapshotForTest = (): SessionSnapshot => {
  const jar = toughCookieJarPort.create()
  jar.setCookieSync("voila-session=sanitized-cookie; Path=/; Secure; HttpOnly", voilaUrl)

  const cookieJar = serializeCookieJar(jar)

  if (Either.isLeft(cookieJar)) {
    throw new Error("Expected cookie jar serialization")
  }

  const session = makeSessionSnapshot(sampleMetadata, { token: csrfToken }, cookieJar.right)

  if (Either.isLeft(session)) {
    throw new Error("Expected session snapshot")
  }

  return session.right
}

const makeSdkSessionForTest = (): SdkSessionSnapshot => {
  const snapshot = makeGuestSdkSessionSnapshot(makeSessionSnapshotForTest())

  if (Either.isLeft(snapshot)) {
    throw new Error("Expected SDK session snapshot")
  }

  return snapshot.right
}

const makeEnvironment = (transport: VoilaTransport): OperationEnvironment => {
  const initialSession = makeSdkSessionForTest()

  return {
    session: {
      load: async () => Either.right(initialSession),
      save: async () => Either.right(undefined)
    },
    transport
  }
}

const makeTransport = (): VoilaTransport => ({
  request: async (request) =>
    Either.right({
      body: JSON.stringify(request.url.pathname === "/graphql" ? completedOrdersResponse : decoratedOrderResponse),
      headers: {},
      status: 200
    })
})

describe("Voila MCP order operations", () => {
  it("returns order details", async () => {
    const result = await runVoilaOperation("voila_get_order_details", {
      orderId: "sanitized-order-id-1"
    }, makeEnvironment(makeTransport()))

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toMatchObject({
        items: [{
          name: "Bananas",
          productId: "product-1",
          quantity: 3
        }],
        orderId: "sanitized-order-id-1"
      })
    }
  })

  it("returns aggregated completed order items", async () => {
    const result = await runVoilaOperation("voila_get_completed_order_items", {
      fromDate: "2026-06-01",
      toDate: "2026-06-30"
    }, makeEnvironment(makeTransport()))

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toMatchObject({
        items: [{
          itemKey: "product-1",
          name: "Bananas",
          totalQuantity: 3
        }],
        ordersMatched: 1,
        ordersScanned: 1
      })
    }
  })
})
