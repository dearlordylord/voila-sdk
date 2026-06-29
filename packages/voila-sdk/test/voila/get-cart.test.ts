import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  getCart,
  makeSessionSnapshot,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const fixtureText = readFileSync(new URL("../fixtures/cart-view-non-empty.json", import.meta.url), "utf8")
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

const makeLeftTransport = (failure: unknown): VoilaTransport => ({
  request: async () => Either.left(failure)
})

const makeThrowingTransport = (failure: unknown): VoilaTransport => ({
  request: async () => {
    throw failure
  }
})

const makeCartResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: {
    "set-cookie": "fresh-cart-cookie=after; Path=/; Secure"
  },
  status
})

const getSessionCookies = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected session cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("getCart", () => {
  it("fetches the active cart through the active session", async () => {
    const fake = makeResponseTransport(makeCartResponse())
    const result = await getCart(makeSession(), fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/cart/v2/carts/active/cart-view")
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.right.value.basketId).toBe("sanitized-basket-id")
      expect(result.right.value.itemCount).toBe(3)
      expect(result.right.value.items[0]?.productId).toBe("sanitized-strawberries-product-id")
      expect(result.right.value.items[1]?.unavailable).toBe(true)
      expect(result.right.value.totals.itemPriceAfterPromos.amount).toBe("8.88")
      expect(result.right.value.checkoutRestrictions[0]?.code).toBe("DELIVERY_SLOT_REQUIRED")
      expect(result.right.value.limitedItems[0]?.code).toBe("MAX_QUANTITY")
      expect(result.right.value.pricingNotifications[0]?.code).toBe("PRICE_CHANGED")
      expect(result.right.value.unavailableData[0]?.code).toBe("UNAVAILABLE")
      expect(getSessionCookies(result.right.session)).toContain("fresh-cart-cookie=after")
    }
  })

  it("normalizes the current root active cart response shape", async () => {
    const fake = makeResponseTransport(makeCartResponse(JSON.stringify({
      activeCheckoutGroup: {
        checkoutRestrictions: ["NOT_REACHED_THRESHOLD", "MISSING_SLOT"]
      },
      cartId: "sanitized-current-cart-id",
      checkoutGroups: {
        assignedCheckoutGroups: [{
          itemGroups: [{
            items: [{
              finalPrice: {
                amount: "4.99",
                currency: "CAD"
              },
              name: "Fresh Farms Strawberries 454 g",
              price: {
                amount: "4.99",
                currency: "CAD"
              },
              productId: "sanitized-current-strawberries-product-id",
              quantity: 2,
              retailerProductId: "111222EA"
            }],
            name: "Fruits & Vegetables"
          }],
          totals: {
            itemPriceAfterPromos: {
              amount: "9.98",
              currency: "CAD"
            },
            itemsRetailPrice: {
              amount: "9.98",
              currency: "CAD"
            },
            savingsPrice: {
              amount: "0.00",
              currency: "CAD"
            },
            taxation: "TAX_EXCLUDED"
          }
        }]
      },
      pricingNotifications: [],
      totals: {
        itemPriceAfterPromos: {
          amount: "9.98",
          currency: "CAD"
        },
        itemsRetailPrice: {
          amount: "9.98",
          currency: "CAD"
        },
        savingsPrice: {
          amount: "0.00",
          currency: "CAD"
        },
        taxation: "TAX_EXCLUDED"
      },
      unavailableData: []
    })))
    const result = await getCart(makeSession(), fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.value.basketId).toBe("sanitized-current-cart-id")
      expect(result.right.value.itemCount).toBe(2)
      expect(result.right.value.items[0]?.groupName).toBe("Fruits & Vegetables")
      expect(result.right.value.checkoutRestrictions[0]?.code).toBe("NOT_REACHED_THRESHOLD")
      expect(result.right.value.checkoutRestrictions[1]?.code).toBe("MISSING_SLOT")
      expect(result.right.value.totals.itemPriceAfterPromos.amount).toBe("9.98")
    }
  })

  it("normalizes an empty current root active cart response without optional groups", async () => {
    const result = await getCart(
      makeSession(),
      makeResponseTransport(makeCartResponse(JSON.stringify({
        cartId: "sanitized-empty-current-cart-id",
        totals: {
          itemPriceAfterPromos: {
            amount: "0.00",
            currency: "CAD"
          },
          itemsRetailPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          savingsPrice: {
            amount: "0.00",
            currency: "CAD"
          },
          taxation: "TAX_EXCLUDED"
        }
      }))).transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.value.basketId).toBe("sanitized-empty-current-cart-id")
      expect(result.right.value.checkoutRestrictions).toEqual([])
      expect(result.right.value.itemCount).toBe(0)
      expect(result.right.value.items).toEqual([])
      expect(result.right.value.pricingNotifications).toEqual([])
      expect(result.right.value.unavailableData).toEqual([])
    }
  })

  it("propagates missing CSRF as a typed recoverable error before network I/O", async () => {
    const fake = makeResponseTransport(makeCartResponse())
    const result = await getCart(makeSession(" "), fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("propagates transport left failures as redacted typed recoverable errors", async () => {
    const result = await getCart(makeSession(), makeLeftTransport("secret-cart-network-token"))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cart-network-token")
    }
  })

  it("propagates thrown transport failures as redacted typed recoverable errors", async () => {
    const result = await getCart(makeSession(), makeThrowingTransport(new Error("secret-cart-thrown-token")))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cart-thrown-token")
    }
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const result = await getCart(
      makeSession(),
      makeResponseTransport(makeCartResponse(JSON.stringify({
        basket: {
          basketId: "basket-id"
        }
      }))).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await getCart(makeSession(), makeResponseTransport(makeCartResponse("{}", 500)).transport)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})
