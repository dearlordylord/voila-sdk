import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  getCart,
  makeSessionSnapshot,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import {
  connectionFailureTransport,
  deadlineExceededTransport,
  respondingTransport,
  responseReadFailureTransport,
  runWith
} from "../helpers/transport.js"

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

const makeCartResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: { "set-cookie": "fresh-cart-cookie=after; Path=/; Secure" },
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
    const fake = respondingTransport(makeCartResponse())
    const result = await runWith(getCart(makeSession()), fake)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests

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
    const fake = respondingTransport(
      makeCartResponse(
        JSON.stringify({
          activeCheckoutGroup: { checkoutRestrictions: ["NOT_REACHED_THRESHOLD", "MISSING_SLOT"] },
          cartId: "sanitized-current-cart-id",
          checkoutGroups: {
            assignedCheckoutGroups: [
              {
                itemGroups: [
                  {
                    items: [
                      {
                        finalPrice: { amount: "4.99", currency: "CAD" },
                        name: "Fresh Farms Strawberries 454 g",
                        price: { amount: "4.99", currency: "CAD" },
                        productId: "sanitized-current-strawberries-product-id",
                        quantity: 2,
                        retailerProductId: "111222EA"
                      }
                    ],
                    name: "Fruits & Vegetables"
                  }
                ],
                totals: {
                  itemPriceAfterPromos: { amount: "9.98", currency: "CAD" },
                  itemsRetailPrice: { amount: "9.98", currency: "CAD" },
                  savingsPrice: { amount: "0.00", currency: "CAD" },
                  taxation: "TAX_EXCLUDED"
                }
              }
            ]
          },
          pricingNotifications: [],
          totals: {
            itemPriceAfterPromos: { amount: "9.98", currency: "CAD" },
            itemsRetailPrice: { amount: "9.98", currency: "CAD" },
            savingsPrice: { amount: "0.00", currency: "CAD" },
            taxation: "TAX_EXCLUDED"
          },
          unavailableData: []
        })
      )
    )
    const result = await runWith(getCart(makeSession()), fake)

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
    const result = await runWith(
      getCart(makeSession()),
      respondingTransport(
        makeCartResponse(
          JSON.stringify({
            cartId: "sanitized-empty-current-cart-id",
            totals: {
              itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
              itemsRetailPrice: { amount: "0.00", currency: "CAD" },
              savingsPrice: { amount: "0.00", currency: "CAD" },
              taxation: "TAX_EXCLUDED"
            }
          })
        )
      )
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
    const fake = respondingTransport(makeCartResponse())
    const result = await runWith(getCart(makeSession(" ")), fake)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("propagates a refused connection as its own typed recoverable error", async () => {
    const result = await runWith(getCart(makeSession()), connectionFailureTransport())

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaConnectionFailure")
    }
  })

  it("distinguishes an abandoned deadline from a refused connection and an unreadable body", async () => {
    const deadline = await runWith(getCart(makeSession()), deadlineExceededTransport())
    const unreadable = await runWith(getCart(makeSession()), responseReadFailureTransport())

    expect(Either.isLeft(deadline) && deadline.left._tag).toBe("VoilaRequestDeadlineExceeded")
    expect(Either.isLeft(unreadable) && unreadable.left._tag).toBe("VoilaResponseReadFailure")
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const result = await runWith(
      getCart(makeSession()),
      respondingTransport(makeCartResponse(JSON.stringify({ basket: { basketId: "basket-id" } })))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await runWith(getCart(makeSession()), respondingTransport(makeCartResponse("{}", 500)))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})
