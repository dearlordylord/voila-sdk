import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
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

const fixtureText = readFileSync(new URL("../fixtures/cart-apply-success.json", import.meta.url), "utf8")
const csrfToken = "csrf-token"
const productUuid = "b952bad2-3d09-4b7f-831a-87ad31eaad3f"
const secondProductUuid = "82683e1a-bd3b-483f-8e2f-53c6f6b9d2f1"
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

const makeMutationResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: {
    "set-cookie": "fresh-mutation-cookie=after; Path=/; Secure"
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

const makeDelta = (productId: string, quantity: number) => {
  const result = makeCartQuantityDelta(productId, quantity)

  if (Either.isLeft(result)) {
    throw new Error("Expected cart delta creation to succeed")
  }

  return result.right
}

describe("applyCartDeltas", () => {
  it("applies batch cart deltas through the active session", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const result = await applyCartDeltas(makeSession(), [
      makeDelta(productUuid, 2),
      makeDelta(secondProductUuid, -1)
    ], fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("POST")
      expect(request?.url.pathname).toBe("/api/cart/v1/carts/active/apply-quantity")
      expect(request?.url.searchParams.get("cartProductSorting")).toBe("CATEGORIES")
      expect(request?.body).toBe(
        `[{\"productId\":\"${productUuid}\",\"quantity\":2},{\"productId\":\"${secondProductUuid}\",\"quantity\":-1}]`
      )
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.right.value.itemCount).toBe(2)
      expect(result.right.value.itemGroups[0]?.items[0]?.productId).toBe("sanitized-strawberries-product-id")
      expect(result.right.value.totals.itemPriceAfterPromos.amount).toBe("8.88")
      expect(result.right.value.pricingNotifications[0]?.code).toBe("PROMO_APPLIED")
      expect(getSessionCookies(result.right.session)).toContain("fresh-mutation-cookie=after")
    }
  })

  it("propagates invalid mutation input before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const invalidDelta = {
      productId: "243255EA",
      quantity: 1
    }
    const result = await applyCartDeltas(makeSession(), [invalidDelta], fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CartQuantityInputInvalid")
    }
  })

  it("rejects empty mutation batches before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const result = await applyCartDeltas(makeSession(), [], fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CartQuantityInputInvalid")
    }
  })

  it("propagates missing CSRF as a typed recoverable error before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const delta = makeAddToCartDelta(productUuid, 1)

    expect(Either.isRight(delta)).toBe(true)

    if (Either.isRight(delta)) {
      const result = await applyCartDeltas(makeSession(" "), [delta.right], fake.transport)

      expect(Either.isLeft(result)).toBe(true)
      expect(fake.requests()).toHaveLength(0)

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("VoilaMissingCsrfToken")
      }
    }
  })

  it("propagates transport left failures as redacted typed recoverable errors", async () => {
    const result = await applyCartDeltas(
      makeSession(),
      [makeDelta(productUuid, 1)],
      makeLeftTransport("secret-cart-mutation-token")
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cart-mutation-token")
    }
  })

  it("propagates thrown transport failures as redacted typed recoverable errors", async () => {
    const result = await applyCartDeltas(
      makeSession(),
      [makeDelta(productUuid, 1)],
      makeThrowingTransport(new Error("secret-cart-mutation-thrown-token"))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNetworkFailure")
      expect(JSON.stringify(result.left)).not.toContain("secret-cart-mutation-thrown-token")
    }
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const result = await applyCartDeltas(
      makeSession(),
      [makeDelta(productUuid, 1)],
      makeResponseTransport(makeMutationResponse(JSON.stringify({
        basketUpdateResult: {},
        limitedItems: [],
        limitedPromotionIds: [],
        pricingNotifications: [],
        unavailableData: []
      }))).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await applyCartDeltas(
      makeSession(),
      [makeDelta(productUuid, 1)],
      makeResponseTransport(makeMutationResponse("{}", 500)).transport
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})

describe("cart item convenience operations", () => {
  it("adds cart items with positive deltas through observable request behavior", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const result = await addCartItems(makeSession(), [{
      productId: productUuid,
      quantity: -2
    }, {
      productId: secondProductUuid,
      quantity: 1
    }], fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.body).toBe(
        `[{\"productId\":\"${productUuid}\",\"quantity\":2},{\"productId\":\"${secondProductUuid}\",\"quantity\":1}]`
      )
      expect(result.right.value.itemCount).toBe(2)
      expect(result.right.value.totals.itemPriceAfterPromos.amount).toBe("8.88")
    }
  })

  it("removes cart items with negative deltas through observable request behavior", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const result = await removeCartItems(makeSession(), [{
      productId: productUuid,
      quantity: -2
    }, {
      productId: secondProductUuid,
      quantity: 1
    }], fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.body).toBe(
        `[{\"productId\":\"${productUuid}\",\"quantity\":-2},{\"productId\":\"${secondProductUuid}\",\"quantity\":-1}]`
      )
      expect(result.right.value.itemGroups[0]?.items[0]?.productId).toBe("sanitized-strawberries-product-id")
    }
  })

  it("rejects invalid convenience item inputs before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const addResult = await addCartItems(makeSession(), [{
      productId: "243255EA",
      quantity: 1
    }], fake.transport)
    const removeResult = await removeCartItems(makeSession(), [{
      productId: productUuid,
      quantity: 0
    }], fake.transport)

    expect(Either.isLeft(addResult)).toBe(true)
    expect(Either.isLeft(removeResult)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(addResult) && Either.isLeft(removeResult)) {
      expect(addResult.left._tag).toBe("CartQuantityDeltaInvalid")
      expect(removeResult.left._tag).toBe("CartItemsInputInvalid")
    }
  })

  it("rejects structurally invalid convenience item inputs before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const addResult = await addCartItems(makeSession(), [null], fake.transport)
    const removeResult = await removeCartItems(makeSession(), "not-items", fake.transport)

    expect(Either.isLeft(addResult)).toBe(true)
    expect(Either.isLeft(removeResult)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(addResult) && Either.isLeft(removeResult)) {
      expect(addResult.left._tag).toBe("CartItemsInputInvalid")
      expect(removeResult.left._tag).toBe("CartItemsInputInvalid")
    }
  })

  it("rejects empty convenience item batches before network I/O", async () => {
    const fake = makeResponseTransport(makeMutationResponse())
    const addResult = await addCartItems(makeSession(), [], fake.transport)
    const removeResult = await removeCartItems(makeSession(), [], fake.transport)

    expect(Either.isLeft(addResult)).toBe(true)
    expect(Either.isLeft(removeResult)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(addResult) && Either.isLeft(removeResult)) {
      expect(addResult.left._tag).toBe("CartQuantityInputInvalid")
      expect(removeResult.left._tag).toBe("CartQuantityInputInvalid")
    }
  })
})
