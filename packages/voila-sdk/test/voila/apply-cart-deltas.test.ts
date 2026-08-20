import { readFileSync } from "node:fs"

import { Result } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  addCartItems,
  applyCartDeltas,
  makeAddToCartDelta,
  makeCartQuantityDelta,
  makeSessionSnapshot,
  removeCartItems,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"
import {
  connectionFailureTransport,
  deadlineExceededTransport,
  respondingTransport,
  runWith
} from "../helpers/transport.js"

const fixtureText = readFileSync(new URL("../fixtures/cart-apply-success.json", import.meta.url), "utf8")
const csrfToken = "csrf-token"
const productUuid = "b952bad2-3d09-4b7f-831a-87ad31eaad3f"
const secondProductUuid = "82683e1a-bd3b-483f-8e2f-53c6f6b9d2f1"
const fixtureStrawberriesProductUuid = "11111111-1111-4111-8111-111111111111"
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

  if (Result.isFailure(cookieJar)) {
    throw new Error("Expected cookie jar serialization to succeed")
  }

  const snapshot = makeSessionSnapshot(sampleMetadata, { token }, cookieJar.success)

  if (Result.isFailure(snapshot)) {
    throw new Error("Expected session snapshot creation to succeed")
  }

  return snapshot.success
}

const makeMutationResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: { "set-cookie": "fresh-mutation-cookie=after; Path=/; Secure" },
  status
})

const getSessionCookies = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Result.isFailure(jar)) {
    throw new Error("Expected session cookie jar to deserialize")
  }

  return jar.success.getCookieStringSync(VOILA_BASE_URL)
}

const makeDelta = (productId: string, quantity: number) => {
  const result = makeCartQuantityDelta(productId, quantity)

  if (Result.isFailure(result)) {
    throw new Error("Expected cart delta creation to succeed")
  }

  return result.success
}

describe("applyCartDeltas", () => {
  it("applies batch cart deltas through the active session", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const result = await runWith(
      applyCartDeltas(makeSession(), [makeDelta(productUuid, 2), makeDelta(secondProductUuid, -1)]),
      fake
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      const [request] = fake.requests

      expect(request?.method).toBe("POST")
      expect(request?.url.pathname).toBe("/api/cart/v1/carts/active/apply-quantity")
      expect(request?.url.searchParams.get("cartProductSorting")).toBe("CATEGORIES")
      expect(request?.body).toBe(
        `[{"productId":"${productUuid}","quantity":2},{"productId":"${secondProductUuid}","quantity":-1}]`
      )
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.success.value.itemCount).toBe(2)
      expect(result.success.value.itemGroups[0]?.items[0]?.productId).toBe(fixtureStrawberriesProductUuid)
      expect(result.success.value.totals.itemPriceAfterPromos.amount).toBe("8.88")
      expect(result.success.value.pricingNotifications[0]?.code).toBe("PROMO_APPLIED")
      expect(getSessionCookies(result.success.session)).toContain("fresh-mutation-cookie=after")
    }
  })

  it("propagates invalid mutation input before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const invalidDelta = { productId: "243255EA", quantity: 1 }
    const result = await runWith(applyCartDeltas(makeSession(), [invalidDelta]), fake)

    expect(Result.isFailure(result)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CartQuantityInputInvalid")
    }
  })

  it("rejects empty mutation batches before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const result = await runWith(applyCartDeltas(makeSession(), []), fake)

    expect(Result.isFailure(result)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("CartQuantityInputInvalid")
    }
  })

  it("propagates missing CSRF as a typed recoverable error before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const delta = makeAddToCartDelta(productUuid, 1)

    expect(Result.isSuccess(delta)).toBe(true)

    if (Result.isSuccess(delta)) {
      const result = await runWith(applyCartDeltas(makeSession(" "), [delta.success]), fake)

      expect(Result.isFailure(result)).toBe(true)
      expect(fake.requests).toHaveLength(0)

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("VoilaMissingCsrfToken")
      }
    }
  })

  it("propagates a refused connection as its own typed recoverable error", async () => {
    const result = await runWith(
      applyCartDeltas(makeSession(), [makeDelta(productUuid, 1)]),
      connectionFailureTransport()
    )

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VoilaConnectionFailure")
    }
  })

  it("distinguishes an abandoned deadline from a refused connection", async () => {
    const result = await runWith(
      applyCartDeltas(makeSession(), [makeDelta(productUuid, 1)]),
      deadlineExceededTransport()
    )

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VoilaRequestDeadlineExceeded")
    }
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const result = await runWith(
      applyCartDeltas(makeSession(), [makeDelta(productUuid, 1)]),
      respondingTransport(
        makeMutationResponse(
          JSON.stringify({
            basketUpdateResult: {},
            limitedItems: [],
            limitedPromotionIds: [],
            pricingNotifications: [],
            unavailableData: []
          })
        )
      )
    )

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await runWith(
      applyCartDeltas(makeSession(), [makeDelta(productUuid, 1)]),
      respondingTransport(makeMutationResponse("{}", 500))
    )

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VoilaNon2xxResponse")
    }
  })
})

describe("cart item convenience operations", () => {
  it("adds cart items with positive deltas through observable request behavior", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const result = await runWith(
      addCartItems(makeSession(), [
        { productId: productUuid, quantity: -2 },
        { productId: secondProductUuid, quantity: 1 }
      ]),
      fake
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      const [request] = fake.requests

      expect(request?.body).toBe(
        `[{"productId":"${productUuid}","quantity":2},{"productId":"${secondProductUuid}","quantity":1}]`
      )
      expect(result.success.value.itemCount).toBe(2)
      expect(result.success.value.totals.itemPriceAfterPromos.amount).toBe("8.88")
    }
  })

  it("removes cart items with negative deltas through observable request behavior", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const result = await runWith(
      removeCartItems(makeSession(), [
        { productId: productUuid, quantity: -2 },
        { productId: secondProductUuid, quantity: 1 }
      ]),
      fake
    )

    expect(Result.isSuccess(result)).toBe(true)

    if (Result.isSuccess(result)) {
      const [request] = fake.requests

      expect(request?.body).toBe(
        `[{"productId":"${productUuid}","quantity":-2},{"productId":"${secondProductUuid}","quantity":-1}]`
      )
      expect(result.success.value.itemGroups[0]?.items[0]?.productId).toBe(fixtureStrawberriesProductUuid)
    }
  })

  it("rejects invalid convenience item inputs before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const addResult = await runWith(addCartItems(makeSession(), [{ productId: "243255EA", quantity: 1 }]), fake)
    const removeResult = await runWith(removeCartItems(makeSession(), [{ productId: productUuid, quantity: 0 }]), fake)

    expect(Result.isFailure(addResult)).toBe(true)
    expect(Result.isFailure(removeResult)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Result.isFailure(addResult) && Result.isFailure(removeResult)) {
      expect(addResult.failure._tag).toBe("CartItemsInputInvalid")
      expect(removeResult.failure._tag).toBe("CartItemsInputInvalid")
    }
  })

  it("rejects structurally invalid convenience item inputs before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const addResult = await runWith(addCartItems(makeSession(), [null]), fake)
    const removeResult = await runWith(removeCartItems(makeSession(), "not-items"), fake)

    expect(Result.isFailure(addResult)).toBe(true)
    expect(Result.isFailure(removeResult)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Result.isFailure(addResult) && Result.isFailure(removeResult)) {
      expect(addResult.failure._tag).toBe("CartItemsInputInvalid")
      expect(removeResult.failure._tag).toBe("CartItemsInputInvalid")
    }
  })

  it("rejects empty convenience item batches before network I/O", async () => {
    const fake = respondingTransport(makeMutationResponse())
    const addResult = await runWith(addCartItems(makeSession(), []), fake)
    const removeResult = await runWith(removeCartItems(makeSession(), []), fake)

    expect(Result.isFailure(addResult)).toBe(true)
    expect(Result.isFailure(removeResult)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Result.isFailure(addResult) && Result.isFailure(removeResult)) {
      expect(addResult.failure._tag).toBe("CartQuantityInputInvalid")
      expect(removeResult.failure._tag).toBe("CartQuantityInputInvalid")
    }
  })
})
