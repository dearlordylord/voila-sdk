import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionSnapshot, VoilaTransport, VoilaTransportRequest, VoilaTransportResponse } from "../../src/index.js"
import {
  makeSessionSnapshot,
  searchProducts,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const fixtureText = readFileSync(new URL("../fixtures/search-response-milk.json", import.meta.url), "utf8")
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

const makeSearchResponse = (body: string = fixtureText, status: number = 200): VoilaTransportResponse => ({
  body,
  headers: {
    "set-cookie": "fresh-search-cookie=after; Path=/; Secure"
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

describe("searchProducts", () => {
  it("searches through the active session and returns normalized products", async () => {
    const fake = makeResponseTransport(makeSearchResponse())
    const result = await searchProducts(makeSession(), {
      categoryContext: {
        retailerCategoryId: "retailer-category-id"
      },
      pageSize: 24,
      pageToken: "next-page-token",
      query: "milk"
    }, fake.transport)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [request] = fake.requests()

      expect(request?.method).toBe("GET")
      expect(request?.url.pathname).toBe("/api/webproductpagews/v6/product-pages/search")
      expect(request?.url.searchParams.get("q")).toBe("milk")
      expect(request?.url.searchParams.get("pageToken")).toBe("next-page-token")
      expect(request?.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-id")
      expect(request?.headers["X-CSRF-TOKEN"]).toBe(csrfToken)
      expect(request?.headers.cookie).toContain("voila-session=before")
      expect(result.right.value.products[0]?.productId).toBe("b952bad2-3d09-4b7f-831a-87ad31eaad3f")
      expect(result.right.value.products[0]?.retailerProductId).toBe("243255EA")
      expect(result.right.value.products[0]?.price.amount).toBe("5.69")
      expect(result.right.value.pagination.nextPageToken).toBe("sanitized-next-page-token")
      expect(getSessionCookies(result.right.session)).toContain("fresh-search-cookie=after")
    }
  })

  it("propagates invalid search input as a typed recoverable error", async () => {
    const fake = makeResponseTransport(makeSearchResponse())
    const result = await searchProducts(makeSession(), {
      pageSize: 0,
      query: ""
    }, fake.transport)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.requests()).toHaveLength(0)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SearchInputInvalid")
    }
  })

  it("propagates HTTP client errors as typed recoverable errors", async () => {
    const result = await searchProducts(makeSession(" "), {
      pageSize: 24,
      query: "milk"
    }, makeResponseTransport(makeSearchResponse()).transport)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaMissingCsrfToken")
    }
  })

  it("propagates schema decode failures as typed recoverable errors", async () => {
    const fake = makeResponseTransport(makeSearchResponse(JSON.stringify({
      productGroups: [{
        decoratedProducts: [{
          available: true
        }],
        type: "featured"
      }]
    })))

    const result = await searchProducts(makeSession(), {
      pageSize: 24,
      query: "milk"
    }, fake.transport)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaSchemaDecodeFailure")
    }
  })

  it("propagates API status errors as typed recoverable errors", async () => {
    const result = await searchProducts(makeSession(), {
      pageSize: 24,
      query: "milk"
    }, makeResponseTransport(makeSearchResponse("{}", 500)).transport)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})
