import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type { DiscountedProductsInput, SessionSnapshot, VoilaTransportResponse } from "../../src/index.js"
import {
  getDiscountedProducts,
  makeDiscountedProductsRequest,
  makeSessionSnapshot,
  normalizeDiscountedProductsResponse,
  parseDiscountedProductsResponse,
  serializeCookieJar,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const csrfToken = "csrf-token"
const sampleMetadata = {
  assetVersion: "asset-version",
  clientRouteId: "client-route-id",
  pageViewId: "page-view-id",
  regionId: "region-id"
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

const makeProduct = (
  name: string,
  price: string,
  promoPrice: string,
  productId: string,
  promotionLabel: string = "Member price"
) => ({
  available: true,
  brand: "Sanitized Brand",
  maxQuantityReached: false,
  name,
  price: {
    amount: price,
    currency: "CAD"
  },
  productId,
  promoPrice: {
    amount: promoPrice,
    currency: "CAD"
  },
  promoUnitPrice: {
    price: {
      amount: "0.40",
      currency: "CAD"
    },
    unit: "fop.price.per.100g"
  },
  promotions: [{
    label: promotionLabel,
    promotionId: "sanitized-promotion-id"
  }],
  quantityInBasket: 0,
  retailerProductId: `${productId}-retailer`,
  unitPrice: {
    price: {
      amount: "0.50",
      currency: "CAD"
    },
    unit: "fop.price.per.100g"
  }
})

const makePromotionResponse = (products: ReadonlyArray<ReturnType<typeof makeProduct>>, nextPageToken?: string) => ({
  ...(nextPageToken === undefined ? {} : { nextPageToken }),
  productGroups: [{
    decoratedProducts: products,
    name: "Promotions",
    type: "promotion"
  }],
  totalProducts: products.length
})

const makeMinimalProduct = (name: string, price: string, promoPrice: string, productId: string) => ({
  available: false,
  maxQuantityReached: false,
  name,
  price: {
    amount: price,
    currency: "CAD"
  },
  productId,
  promoPrice: {
    amount: promoPrice,
    currency: "CAD"
  },
  quantityInBasket: 0,
  retailerProductId: `${productId}-retailer`
})

const requestInput = {
  pageSize: 24
} satisfies DiscountedProductsInput

describe("discounted product normalization", () => {
  it("decodes raw promotion payloads and computes savings fields", () => {
    const result = parseDiscountedProductsResponse(
      makePromotionResponse([
        makeProduct("Discounted milk", "5.00", "4.00", "milk-id")
      ]),
      requestInput
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      const [product] = result.right.products

      expect(product?.regularPrice.amount).toBe("5.00")
      expect(product?.discountPrice.amount).toBe("4.00")
      expect(product?.savingsAmount).toBe(1)
      expect(product?.savingsPercent).toBe(20)
      expect(product?.savingsPrice).toEqual({
        amount: "1.00",
        currency: "CAD"
      })
      expect(product?.promoUnitPrice?.price.amount).toBe("0.40")
      expect(product?.promotionSummary).toBe("Member price")
      expect(product?.sourceGroupName).toBe("Promotions")
    }
  })

  it("filters one-cent noise by default but keeps cheap real percentage discounts", () => {
    const result = normalizeDiscountedProductsResponse(
      makePromotionResponse([
        makeProduct("Noise discount", "5.00", "4.99", "noise-id"),
        makeProduct("Cheap real discount", "1.00", "0.89", "cheap-id")
      ]),
      requestInput,
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 24,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual(["cheap-id"])
    expect(result.products[0]?.savingsAmount).toBe(0.11)
    expect(result.products[0]?.savingsPercent).toBe(11)
  })

  it("applies query filtering locally and sorts requested results", () => {
    const result = normalizeDiscountedProductsResponse(
      makePromotionResponse([
        makeProduct("Discounted cereal", "6.00", "5.00", "cereal-id"),
        makeProduct("Discounted oat milk", "5.00", "4.00", "milk-id"),
        makeProduct("Premium milk", "10.00", "8.00", "premium-milk-id")
      ]),
      {
        pageSize: 2,
        query: "milk",
        sort: "price-asc"
      },
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 2,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual(["milk-id", "premium-milk-id"])
    expect(result.scan.matchedProducts).toBe(2)
    expect(result.scan.returnedProducts).toBe(2)
  })

  it("sorts by savings amount when requested", () => {
    const result = normalizeDiscountedProductsResponse(
      makePromotionResponse([
        makeProduct("Percent winner", "5.00", "4.00", "percent-id"),
        makeProduct("Amount winner", "20.00", "17.00", "amount-id")
      ]),
      {
        pageSize: 2,
        sort: "best-amount"
      },
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 2,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual(["amount-id", "percent-id"])
  })

  it("sorts by savings percent when requested", () => {
    const result = normalizeDiscountedProductsResponse(
      makePromotionResponse([
        makeProduct("Amount winner", "20.00", "17.00", "amount-id"),
        makeProduct("Percent winner", "5.00", "4.00", "percent-id")
      ]),
      {
        pageSize: 2,
        sort: "best-percent"
      },
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 2,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual(["percent-id", "amount-id"])
  })

  it("uses promotion metadata fallback fields for summaries", () => {
    const result = normalizeDiscountedProductsResponse(
      {
        productGroups: [{
          products: [
            {
              ...makeMinimalProduct("Name promo", "5.00", "4.00", "name-id"),
              packSizeDescription: "500 g",
              promotions: [{
                name: "Name summary"
              }]
            },
            {
              ...makeMinimalProduct("Description promo", "5.00", "4.00", "description-id"),
              promotions: [{
                description: "Description summary"
              }]
            },
            {
              ...makeMinimalProduct("Type promo", "5.00", "4.00", "type-id"),
              promotions: [{
                label: " ",
                type: "TYPE_SUMMARY"
              }]
            }
          ],
          type: "promotion"
        }]
      },
      requestInput,
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 24,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.promotionSummary)).toEqual([
      "Name summary",
      "Description summary",
      "TYPE_SUMMARY"
    ])
    expect(result.products[0]?.packSizeDescription).toBe("500 g")
  })

  it("matches queries when optional searchable fields are absent", () => {
    const result = normalizeDiscountedProductsResponse(
      {
        productGroups: [{
          products: [
            {
              ...makeMinimalProduct("Retailer match", "5.00", "4.00", "retailer-match-id"),
              packSizeDescription: "750 g"
            },
            {
              ...makeMinimalProduct("Description match", "5.00", "4.00", "description-match-id"),
              promotions: [{
                description: "Coupon text"
              }]
            },
            {
              ...makeMinimalProduct("Type-only match", "5.00", "4.00", "type-match-id"),
              promotions: [{
                type: "TYPE_ONLY"
              }]
            }
          ],
          type: "promotion"
        }]
      },
      {
        pageSize: 3,
        query: "match"
      },
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 3,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual([
      "retailer-match-id",
      "description-match-id",
      "type-match-id"
    ])
  })

  it("omits optional normalized fields when Voila omits source fields", () => {
    const result = normalizeDiscountedProductsResponse(
      {
        productGroups: [{
          products: [makeMinimalProduct("Minimal discount", "8.00", "6.00", "minimal-id")],
          type: "promotion"
        }]
      },
      requestInput,
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 24,
        returnedProducts: 0
      }
    )

    const [product] = result.products

    expect(product?.productId).toBe("minimal-id")
    expect(product).not.toHaveProperty("brand")
    expect(product).not.toHaveProperty("promotionSummary")
    expect(product).not.toHaveProperty("sourceGroupName")
    expect(product).not.toHaveProperty("unitPrice")
    expect(product?.promotions).toEqual([])
  })

  it("filters products without usable regular and promo prices", () => {
    const result = normalizeDiscountedProductsResponse(
      {
        productGroups: [{
          products: [
            {
              available: true,
              maxQuantityReached: false,
              name: "Missing promo",
              price: {
                amount: "5.00",
                currency: "CAD"
              },
              productId: "missing-promo-id",
              quantityInBasket: 0,
              retailerProductId: "missing-promo-retailer"
            },
            makeMinimalProduct("Invalid regular", "not-a-price", "4.00", "invalid-regular-id"),
            makeMinimalProduct("Invalid promo", "5.00", "not-a-price", "invalid-promo-id"),
            makeMinimalProduct("Not discounted", "5.00", "5.00", "not-discounted-id"),
            makeMinimalProduct("Real discount", "5.00", "4.00", "real-id")
          ],
          type: "promotion"
        }]
      },
      requestInput,
      {
        exhausted: true,
        matchedProducts: 0,
        maxPages: 1,
        pagesScanned: 1,
        requestedPageSize: 24,
        returnedProducts: 0
      }
    )

    expect(result.products.map((product) => product.productId)).toEqual(["real-id"])
  })

  it("returns a typed schema mismatch for malformed promotion responses", () => {
    const result = parseDiscountedProductsResponse({
      productGroups: [{
        products: [{
          available: true
        }],
        type: "promotion"
      }]
    }, requestInput)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DiscountedProductsResponseSchemaMismatch")
    }
  })

  it("preserves pagination and started scan token metadata", () => {
    const result = parseDiscountedProductsResponse({
      nextPageToken: "next-token",
      productGroups: [{
        products: [makeMinimalProduct("Paged discount", "5.00", "4.00", "paged-id")],
        type: "promotion"
      }]
    }, {
      pageSize: 1,
      pageToken: "start-token"
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.pagination).toEqual({
        nextPageToken: "next-token"
      })
      expect(result.right.scan).toMatchObject({
        exhausted: false,
        nextPageToken: "next-token",
        startedPageToken: "start-token"
      })
    }
  })

  it("builds deterministic promotions endpoint requests", () => {
    const request = makeDiscountedProductsRequest({
      categoryId: "category-id",
      pageSize: 12,
      pageToken: "next-token",
      query: "ignored by endpoint",
      retailerCategoryId: "retailer-category-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("GET")
      expect(request.right.url.pathname).toBe("/api/product-listing-pages/v1/pages/promotions")
      expect(request.right.url.searchParams.get("categoryId")).toBe("category-id")
      expect(request.right.url.searchParams.get("retailerCategoryId")).toBe("retailer-category-id")
      expect(request.right.url.searchParams.get("pageToken")).toBe("next-token")
      expect(request.right.url.searchParams.has("q")).toBe(false)
    }
  })

  it("uses the SDK default page size when callers omit pageSize", () => {
    const request = makeDiscountedProductsRequest({})

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.url.searchParams.get("maxPageSize")).toBe("12")
      expect(request.right.url.searchParams.get("maxProductsToDecorate")).toBe("12")
    }
  })

  it("rejects invalid promotions endpoint request inputs", () => {
    const request = makeDiscountedProductsRequest({
      pageSize: 0
    })

    expect(Either.isLeft(request)).toBe(true)
  })

  it("scans promotion pages for sparse query matches", async () => {
    const responses: ReadonlyArray<VoilaTransportResponse> = [
      {
        body: JSON.stringify(
          makePromotionResponse([makeProduct("Discounted cereal", "6.00", "5.00", "cereal-id")], "p2")
        ),
        headers: {},
        status: 200
      },
      {
        body: JSON.stringify(makePromotionResponse([makeProduct("Discounted milk", "5.00", "4.00", "milk-id")])),
        headers: {},
        status: 200
      }
    ]
    const requests: Array<URL> = []
    let index = 0
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 1,
      query: "milk"
    }, {
      request: async (request) => {
        requests.push(request.url)
        const response = responses[index]
        index += 1

        return response === undefined ? Either.left("missing response") : Either.right(response)
      }
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(requests).toHaveLength(2)
      expect(requests[0]?.searchParams.has("q")).toBe(false)
      expect(requests[1]?.searchParams.get("pageToken")).toBe("p2")
      expect(result.right.value.products.map((product) => product.productId)).toEqual(["milk-id"])
      expect(result.right.value.scan.pagesScanned).toBe(2)
      expect(result.right.value.scan.exhausted).toBe(true)
    }
  })

  it("returns all query matches from scanned pages when a page overshoots the fill target", async () => {
    const responses: ReadonlyArray<VoilaTransportResponse> = [
      {
        body: JSON.stringify(makePromotionResponse([
          makeProduct("Discounted milk one", "5.00", "4.00", "milk-id-1")
        ], "p2")),
        headers: {},
        status: 200
      },
      {
        body: JSON.stringify(makePromotionResponse([
          makeProduct("Discounted milk two", "5.00", "4.00", "milk-id-2"),
          makeProduct("Discounted milk three", "5.00", "4.00", "milk-id-3")
        ], "p3")),
        headers: {},
        status: 200
      }
    ]
    let index = 0
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 2,
      query: "milk"
    }, {
      request: async () => {
        const response = responses[index]
        index += 1

        return response === undefined ? Either.left("missing response") : Either.right(response)
      }
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.value.products.map((product) => product.productId)).toEqual([
        "milk-id-1",
        "milk-id-2",
        "milk-id-3"
      ])
      expect(result.right.value.pagination.nextPageToken).toBe("p3")
      expect(result.right.value.scan).toMatchObject({
        matchedProducts: 3,
        requestedPageSize: 2,
        returnedProducts: 3
      })
    }
  })

  it("passes explicit page tokens through no-query promotion requests", async () => {
    const requests: Array<URL> = []
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 1,
      pageToken: "start-token"
    }, {
      request: async (request) => {
        requests.push(request.url)

        return Either.right({
          body: JSON.stringify(makePromotionResponse([
            makeProduct("Discounted milk", "5.00", "4.00", "milk-id")
          ])),
          headers: {},
          status: 200
        })
      }
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(requests).toHaveLength(1)
      expect(requests[0]?.searchParams.get("pageToken")).toBe("start-token")
      expect(result.right.value.scan.startedPageToken).toBe("start-token")
      expect(result.right.value.scan.maxPages).toBe(1)
    }
  })

  it("stops query scans at five pages and exposes incomplete scan metadata", async () => {
    const requests: Array<URL> = []
    let index = 0
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 1,
      query: "milk"
    }, {
      request: async (request) => {
        requests.push(request.url)
        index += 1

        return Either.right({
          body: JSON.stringify(makePromotionResponse([
            makeProduct(`Discounted cereal ${index}`, "6.00", "5.00", `cereal-id-${index}`)
          ], `p${index + 1}`)),
          headers: {},
          status: 200
        })
      }
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(requests).toHaveLength(5)
      expect(result.right.value.products).toEqual([])
      expect(result.right.value.scan).toMatchObject({
        exhausted: false,
        maxPages: 5,
        nextPageToken: "p6",
        pagesScanned: 5
      })
    }
  })

  it("propagates invalid SDK input before making a promotions request", async () => {
    let called = false
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 0
    }, {
      request: async () => {
        called = true

        return Either.left("unused")
      }
    })

    expect(Either.isLeft(result)).toBe(true)
    expect(called).toBe(false)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DiscountedProductsInputInvalid")
    }
  })

  it("uses the SDK default page size for direct discounted product calls", async () => {
    const requests: Array<URL> = []
    const result = await getDiscountedProducts(makeSession(), {}, {
      request: async (request) => {
        requests.push(request.url)

        return Either.right({
          body: JSON.stringify(makePromotionResponse([
            makeProduct("Discounted milk", "5.00", "4.00", "milk-id")
          ])),
          headers: {},
          status: 200
        })
      }
    })

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(requests[0]?.searchParams.get("maxPageSize")).toBe("12")
      expect(result.right.value.scan.requestedPageSize).toBe(12)
      expect(result.right.value.products.map((product) => product.productId)).toEqual(["milk-id"])
    }
  })

  it("propagates HTTP client failures as typed recoverable errors", async () => {
    const result = await getDiscountedProducts(makeSession(), {
      pageSize: 1
    }, {
      request: async () =>
        Either.right({
          body: "{}",
          headers: {},
          status: 500
        })
    })

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaNon2xxResponse")
    }
  })
})
