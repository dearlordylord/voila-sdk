import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"
import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  getCheckoutSummary,
  makeSessionSnapshot,
  normalizeCheckoutSummaryResponse,
  NormalizedCheckoutSummarySchema,
  parseCheckoutSummaryResponse,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import { assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const blockedFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-blocked.json", import.meta.url),
  "utf8"
)
const missingSlotFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-missing-slot.json", import.meta.url),
  "utf8"
)
const unavailableFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-unavailable-item.json", import.meta.url),
  "utf8"
)
const readyFixtureText = readFileSync(
  new URL("../fixtures/checkout-summary-ready.json", import.meta.url),
  "utf8"
)
const csrfToken = "csrf-token"
const serviceDownBody = "{\"message\":\"sanitized checkout service unavailable\"}"

const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "client-page-view-id",
  regionId: "region-id"
}

const readFixture = (fixtureText: string): unknown => {
  const parsed = parseJson(fixtureText)

  if (Either.isLeft(parsed)) {
    throw new Error("Expected fixture JSON to parse")
  }

  return parsed.right
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

const makeResponse = (
  body: string,
  status: number = 200
): VoilaTransportResponse => ({
  body,
  headers: {},
  status
})

const makeResponseTransport = (
  response: VoilaTransportResponse
): {
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

describe("checkout summary parsing", () => {
  it("normalizes blocked checkout summaries and preserves blocking restrictions", () => {
    const result = parseCheckoutSummaryResponse(readFixture(blockedFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.basketId).toBe("sanitized-blocked-cart-id")
      expect(result.right.canCheckout).toBe(false)
      expect(result.right.basketAboveThreshold).toBe(false)
      expect(result.right.checkoutRestrictions[0]?.code).toBe("EMPTY_CART")
      expect(result.right.minimumCheckoutThreshold).toEqual({
        amount: "50.00",
        currency: "CAD"
      })
      expect(result.right.warnings.map((warning) => warning.kind)).toEqual(["checkout-restriction"])
    }
  })

  it("normalizes missing-slot summaries without inventing selected slot state", () => {
    const result = parseCheckoutSummaryResponse(readFixture(missingSlotFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.canCheckout).toBe(false)
      expect(result.right.selectedSlot).toBeUndefined()
      expect(result.right.checkoutRestrictions[0]?.code).toBe("DELIVERY_SLOT_REQUIRED")
      expect(result.right.fees.smallOrder).toEqual({
        amount: "0.00",
        currency: "CAD"
      })
    }
  })

  it("preserves unavailable item, limited item, substitution, and price warnings", () => {
    const result = parseCheckoutSummaryResponse(readFixture(unavailableFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.selectedSlot?.slotId).toBe("sanitized-slot-id")
      expect(result.right.unavailableData[0]?.productId).toBe("sanitized-unavailable-product-id")
      expect(result.right.limitedItems[0]?.productId).toBe("sanitized-limited-product-id")
      expect(result.right.substitutions[0]?.productId).toBe("sanitized-substitution-product-id")
      expect(result.right.pricingNotifications[0]?.productId).toBe("sanitized-price-change-product-id")
      expect(result.right.warnings.map((warning) => warning.kind)).toEqual([
        "checkout-restriction",
        "limited-item",
        "pricing-notification",
        "substitution",
        "unavailable-item"
      ])
    }
  })

  it("normalizes ready-to-review summaries with totals, fees, and selected slot", () => {
    const result = parseCheckoutSummaryResponse(readFixture(readyFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.canCheckout).toBe(true)
      expect(result.right.warnings).toEqual([])
      expect(result.right.totals?.finalPrice).toEqual({
        amount: "84.09",
        currency: "CAD"
      })
      expect(result.right.fees).toEqual({
        carrierBag: {
          amount: "0.10",
          currency: "CAD"
        },
        delivery: {
          amount: "3.99",
          currency: "CAD"
        },
        smallOrder: {
          amount: "0.00",
          currency: "CAD"
        }
      })
      expect(result.right.selectedSlot?.expiryTime).toBe("2026-07-01T07:45:00-04:00")
    }
  })

  it("keeps normalized checkout summaries under the public schema", () => {
    const result = parseCheckoutSummaryResponse(readFixture(readyFixtureText))

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const decoded = assertDecodeSuccess(NormalizedCheckoutSummarySchema, result.right)
      expect(assertEncodeSuccess(NormalizedCheckoutSummarySchema, decoded)).toEqual(result.right)
    }
  })

  it("defaults omitted optional summary arrays and flags", () => {
    const result = normalizeCheckoutSummaryResponse({
      checkout: {}
    })

    expect(result).toEqual({
      basketAboveThreshold: false,
      canCheckout: false,
      checkoutRestrictions: [],
      fees: {},
      limitedItems: [],
      pricingNotifications: [],
      substitutions: [],
      unavailableData: [],
      warnings: []
    })
  })

  it("normalizes sparse selected slot data and invoice/preparation fees", () => {
    const result = normalizeCheckoutSummaryResponse({
      charges: {
        invoice: {
          finalPrice: {
            amount: "1.00",
            currency: "CAD"
          }
        },
        preparation: {
          price: {
            amount: "2.00",
            currency: "CAD"
          }
        }
      },
      checkout: {
        delivery: {}
      }
    })

    expect(result.fees).toEqual({
      invoice: {
        amount: "1.00",
        currency: "CAD"
      },
      preparation: {
        amount: "2.00",
        currency: "CAD"
      }
    })
    expect(result.selectedSlot).toEqual({})
  })

  it("fails at the schema boundary without leaking checkout response bodies", () => {
    const result = parseCheckoutSummaryResponse({
      formattedAddress: "123 Secret Street"
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CheckoutSummarySchemaMismatch")
      expect(JSON.stringify(result.left)).not.toContain("123 Secret Street")
    }
  })
})

describe("getCheckoutSummary", () => {
  it("reads checkout summaries without using update or order placement endpoints", async () => {
    const fake = makeResponseTransport(makeResponse(readyFixtureText))
    const result = await getCheckoutSummary(
      makeSession(),
      {
        appliedPaymentCheckId: "sanitized-payment-check-id",
        fetchAllocatedPaymentChecks: true
      },
      fake.transport
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.href).toBe(
        `${VOILA_BASE_URL}/api/cart/v1/carts/active/checkout-summary?fetchAllocatedPaymentChecks=true&paymentCheckId=sanitized-payment-check-id`
      )
      expect(request?.url.href).not.toContain("place-order")
      expect(request?.url.href).not.toContain("orders")
      expect(request?.body).toBeUndefined()
      expect(result.right.value.canCheckout).toBe(true)
    }
  })

  it("rejects invalid checkout summary input before network I/O", async () => {
    const fake = makeResponseTransport(makeResponse(readyFixtureText))
    const result = await getCheckoutSummary(
      makeSession(),
      {
        appliedPaymentCheckId: ""
      },
      fake.transport
    )

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CheckoutSummaryInputInvalid")
    }
  })

  it("returns typed service errors without leaking response bodies", async () => {
    const result = await getCheckoutSummary(
      makeSession(),
      {},
      makeResponseTransport(makeResponse(serviceDownBody, 503)).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
      expect(JSON.stringify(result.left)).not.toContain("sanitized checkout service unavailable")
    }
  })
})
