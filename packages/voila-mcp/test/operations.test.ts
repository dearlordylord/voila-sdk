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
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { makeAuthGuidance } from "../src/auth-guidance.js"
import { makeNodeOperationEnvironment } from "../src/node-env.js"
import { mcpName, type OperationEnvironment, runVoilaOperation, voilaOperationDescriptors } from "../src/operations.js"

const voilaUrl = "https://voila.ca/"
const csrfToken = "csrf-token"
const secretNetworkValue = "secret-network-value"
const sessionPath = "/tmp/voila-session.json"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
}

const completedOrdersResponse = JSON.stringify({
  data: {
    completedOrders: {
      edges: [{
        node: {
          orderId: "sanitized-order-id-1",
          prices: {
            total: {
              amount: "42.50",
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
      }],
      pageInfo: {
        endCursor: "sanitized-next-order-cursor",
        hasNextPage: true
      },
      retentionPeriod: "P1Y"
    }
  }
})

const discountedProductsResponse = JSON.stringify({
  productGroups: [{
    decoratedProducts: [{
      available: true,
      brand: "Sanitized Brand",
      maxQuantityReached: false,
      name: "Discounted milk",
      price: {
        amount: "5.00",
        currency: "CAD"
      },
      productId: "sanitized-discount-product-id",
      promoPrice: {
        amount: "4.00",
        currency: "CAD"
      },
      promotions: [{
        label: "Member price",
        promotionId: "sanitized-promotion-id"
      }],
      quantityInBasket: 0,
      retailerProductId: "123456EA"
    }],
    name: "Promotions",
    type: "promotion"
  }]
})

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`../../voila-sdk/test/fixtures/${name}`, import.meta.url), "utf8")

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

const makeEnvironment = (
  transport: VoilaTransport
): {
  readonly env: OperationEnvironment
  readonly saved: () => SdkSessionSnapshot | undefined
} => {
  let savedSession: SdkSessionSnapshot | undefined
  const initialSession = makeSdkSessionForTest()

  return {
    env: {
      session: {
        load: async () => Either.right(savedSession ?? initialSession),
        save: async (snapshot) => {
          savedSession = snapshot

          return Either.right(undefined)
        }
      },
      transport
    },
    saved: () => savedSession
  }
}

describe("Voila MCP operations", () => {
  it("exposes the expected MCP server name and tool registry", () => {
    expect(mcpName).toBe("io.github.dearlordylord/voila-mcp")
    expect(voilaOperationDescriptors.map((operation) => operation.name)).toEqual([
      "voila_check_session_health",
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
  })

  it("validates input before loading a session", async () => {
    let loaded = false
    const env: OperationEnvironment = {
      session: {
        load: async () => {
          loaded = true

          return Either.right(makeSdkSessionForTest())
        },
        save: async () => Either.right(undefined)
      },
      transport: {
        request: async () => Either.left("unused")
      }
    }

    const result = await runVoilaOperation("voila_search_products", {}, env)

    expect(result.ok).toBe(false)
    expect(loaded).toBe(false)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaOperationInputInvalid")
    }
  })

  it("rejects invalid discounted product operation inputs before loading a session", async () => {
    for (
      const input of [
        {
          minSavingsAmount: -1
        },
        {
          minSavingsPercent: -1
        },
        {
          pageSize: 25
        },
        {
          sort: "unsupported"
        }
      ]
    ) {
      let loaded = false
      const env: OperationEnvironment = {
        session: {
          load: async () => {
            loaded = true

            return Either.right(makeSdkSessionForTest())
          },
          save: async () => Either.right(undefined)
        },
        transport: {
          request: async () => Either.left("unused")
        }
      }

      const result = await runVoilaOperation("voila_get_discounted_products", input, env)

      expect(result.ok).toBe(false)
      expect(loaded).toBe(false)

      if (!result.ok) {
        expect(result.error._tag).toBe("VoilaOperationInputInvalid")
      }
    }
  })

  it("bootstraps a guest session when no session file is configured", async () => {
    const homepage = await fixture("voila-homepage.html")
    const env = makeNodeOperationEnvironment({}, {
      request: async () =>
        Either.right({
          body: homepage,
          headers: {
            "set-cookie": "voila-session=sanitized-cookie; Path=/; Secure; HttpOnly"
          },
          status: 200
        })
    })

    expect(Either.isRight(env)).toBe(true)

    if (Either.isRight(env)) {
      const session = await env.right.session.load()

      expect(Either.isRight(session)).toBe(true)

      if (Either.isRight(session)) {
        expect(session.right.kind).toBe("guest")
      }
    }
  })

  it("returns CLI login guidance for guest session health", async () => {
    const fake = makeEnvironment({
      request: async () =>
        Either.right({
          body: JSON.stringify({
            authenticated: false
          }),
          headers: {},
          status: 200
        })
    })
    const env: OperationEnvironment = {
      ...fake.env,
      authGuidance: makeAuthGuidance(sessionPath)
    }
    const result = await runVoilaOperation("voila_check_session_health", {}, env)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.authGuidance?.mcpEnv.VOILA_AUTH_SESSION_PATH).toBe(sessionPath)
      expect(result.authGuidance?.instructions).toContain("close the browser window")
    }
  })

  it("returns CLI login guidance when configured session loading fails", async () => {
    const env: OperationEnvironment = {
      authGuidance: makeAuthGuidance(sessionPath),
      session: {
        load: async () =>
          Either.left({
            _tag: "SdkSessionStorageReadFailed",
            message: "Session could not be read"
          }),
        save: async () => Either.right(undefined)
      },
      transport: {
        request: async () => Either.left("unused")
      }
    }

    const result = await runVoilaOperation("voila_get_cart", {}, env)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.error.authGuidance?.instructions).toContain("retry the MCP request")
    }
  })

  it("returns normalized cart mutation data and persists the updated session", async () => {
    const cartApply = await fixture("cart-apply-success.json")
    const fake = makeEnvironment({
      request: async () =>
        Either.right({
          body: cartApply,
          headers: {},
          status: 200
        })
    })

    const result = await runVoilaOperation("voila_add_cart_items", {
      items: [{
        productId: "11111111-1111-4111-8111-111111111111",
        quantity: 1
      }]
    }, fake.env)

    expect(result.ok).toBe(true)
    expect(fake.saved()?.kind).toBe("guest")

    if (result.ok) {
      expect(result.value).toMatchObject({
        itemCount: 2,
        limitedItems: [],
        pricingNotifications: [{
          code: "PROMO_APPLIED"
        }],
        unavailableData: []
      })
    }
  })

  it("returns paginated completed orders", async () => {
    const fake = makeEnvironment({
      request: async () =>
        Either.right({
          body: completedOrdersResponse,
          headers: {},
          status: 200
        })
    })

    const result = await runVoilaOperation("voila_get_completed_orders", {
      pageSize: 2,
      pageToken: "previous-cursor"
    }, fake.env)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value).toMatchObject({
        pagination: {
          hasNextPage: true,
          nextPageToken: "sanitized-next-order-cursor"
        }
      })
      expect(result.value).toHaveProperty("orders")
      expect(JSON.stringify(result.value)).toContain("sanitized-order-id-1")
    }
  })

  it("returns normalized discounted products through the SDK registry path", async () => {
    const paths: Array<string> = []
    const fake = makeEnvironment({
      request: async (request) => {
        paths.push(request.url.pathname)

        return Either.right({
          body: discountedProductsResponse,
          headers: {},
          status: 200
        })
      }
    })

    const result = await runVoilaOperation("voila_get_discounted_products", {
      minSavingsPercent: 15,
      pageSize: 3,
      query: "milk",
      sort: "best-percent"
    }, fake.env)

    expect(result.ok).toBe(true)
    expect(paths).toEqual(["/api/product-listing-pages/v1/pages/promotions"])

    if (result.ok) {
      expect(result.value).toMatchObject({
        products: [{
          discountPrice: {
            amount: "4.00"
          },
          productId: "sanitized-discount-product-id",
          promotionSummary: "Member price",
          savingsAmount: 1,
          savingsPercent: 20
        }],
        scan: {
          pagesScanned: 1
        }
      })
    }
  })

  it("returns CLI login guidance for completed order GraphQL failures", async () => {
    const fake = makeEnvironment({
      request: async () =>
        Either.right({
          body: JSON.stringify({
            errors: [{
              message: "secret-account-required-detail"
            }]
          }),
          headers: {},
          status: 200
        })
    })
    const env: OperationEnvironment = {
      ...fake.env,
      authGuidance: makeAuthGuidance(sessionPath)
    }

    const result = await runVoilaOperation("voila_get_completed_orders", {}, env)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain("secret-account-required-detail")

    if (!result.ok) {
      expect(result.error._tag).toBe("CompletedOrdersGraphqlError")
      expect(result.error.authGuidance?.command).toBe(`npx -y @firfi/voila-cli auth login --session ${sessionPath}`)
      expect(result.error.authGuidance?.instructions).toContain("retry the MCP request")
    }
  })

  it("redacts thrown transport failures", async () => {
    const fake = makeEnvironment({
      request: async () => {
        throw new Error(secretNetworkValue)
      }
    })

    const result = await runVoilaOperation("voila_get_cart", {}, fake.env)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secretNetworkValue)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaNetworkFailure")
    }
  })
})
