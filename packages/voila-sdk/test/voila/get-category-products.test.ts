import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  getCategoryProducts,
  makeSessionSnapshot,
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

const fixtureText = readFileSync(new URL("../fixtures/category-products-produce.json", import.meta.url), "utf8")
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

const makeCategoryResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: { "set-cookie": "fresh-category-cookie=after; Path=/; Secure" },
  status
})

const getSessionCookies = (session: SessionSnapshot): string => {
  const jar = toughCookieJarPort.deserialize(session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected session cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("getCategoryProducts", () => {
  it("gets category products through the active session using retailer category ID", async () => {
    const fake = respondingTransport(makeCategoryResponse())
    const result = await runWith(
      getCategoryProducts(makeSession(), {
        filters: [{ id: "brand", value: "fresh-farms" }],
        pageSize: 24,
        pageToken: "next-page-token",
        retailerCategoryId: "retailer-category-produce"
      }),
      fake
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/webproductpagews/v6/product-pages")
      expect(request?.url.searchParams.get("pageToken")).toBe("next-page-token")
      expect(request?.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-produce")
      expect(request?.url.searchParams.getAll("filter")).toEqual(["brand:fresh-farms"])
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.right.value.category.categoryId).toBe("sanitized-category-produce")
      expect(result.right.value.category.retailerCategoryId).toBe("retailer-category-produce")
      expect(result.right.value.products[0]?.productId).toBe("sanitized-strawberries-product-id")
      expect(result.right.value.products[0]?.retailerProductId).toBe("111222EA")
      expect(result.right.value.products[0]?.price.amount).toBe("4.99")
      expect(result.right.value.pagination.nextPageToken).toBe("sanitized-category-next-page-token")
      expect(result.right.value.filters[0]?.id).toBe("brand")
      expect(getSessionCookies(result.right.session)).toContain("fresh-category-cookie=after")
    }
  })

  it("gets category products through the active session using category ID", async () => {
    const fake = respondingTransport(makeCategoryResponse())
    const result = await runWith(
      getCategoryProducts(makeSession(), { categoryId: "sanitized-category-produce", pageSize: 12 }),
      fake
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests

      expect(request?.url.searchParams.get("categoryId")).toBe("sanitized-category-produce")
      expect(request?.url.searchParams.has("retailerCategoryId")).toBe(false)
    }
  })

  it("propagates invalid category input as a typed recoverable error", async () => {
    const fake = respondingTransport(makeCategoryResponse())
    const result = await runWith(getCategoryProducts(makeSession(), { pageSize: 0 }), fake)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("CategoryPageInputInvalid")
    }
  })

  it("propagates HTTP client errors as typed recoverable errors", async () => {
    const result = await runWith(
      getCategoryProducts(makeSession(" "), { pageSize: 24, retailerCategoryId: "retailer-category-produce" }),
      respondingTransport(makeCategoryResponse())
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("propagates a refused connection as its own typed recoverable error", async () => {
    const result = await runWith(
      getCategoryProducts(makeSession(), { pageSize: 24, retailerCategoryId: "retailer-category-produce" }),
      connectionFailureTransport()
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaConnectionFailure")
    }
  })

  it("distinguishes an abandoned deadline from a refused connection", async () => {
    const result = await runWith(
      getCategoryProducts(makeSession(), { pageSize: 24, retailerCategoryId: "retailer-category-produce" }),
      deadlineExceededTransport()
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaRequestDeadlineExceeded")
    }
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const fake = respondingTransport(
      makeCategoryResponse(
        JSON.stringify({
          category: { categoryId: "category-id", retailerCategoryId: "retailer-category-id" },
          productGroups: [{ products: [{ available: true }], type: "standard" }]
        })
      )
    )

    const result = await runWith(
      getCategoryProducts(makeSession(), { pageSize: 24, retailerCategoryId: "retailer-category-produce" }),
      fake
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await runWith(
      getCategoryProducts(makeSession(), { pageSize: 24, retailerCategoryId: "retailer-category-produce" }),
      respondingTransport(makeCategoryResponse("{}", 500))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})
