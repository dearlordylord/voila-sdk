import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  DEFAULT_MIN_SAVINGS_AMOUNT,
  DEFAULT_MIN_SAVINGS_PERCENT,
  type DiscountedProductsInput,
  DiscountedProductsInputSchema,
  type DiscountSort,
  MAX_DISCOUNT_QUERY_SCAN_PAGES,
  type Money,
  type PromotionProductsResponse,
  PromotionProductsResponseSchema,
  type RawPromotionMetadata,
  type RawPromotionProduct,
  type SessionSnapshot,
  type UnitPrice
} from "../domain/schemas/index.js"
import { type DiscountedProductsRequestError, makeDiscountedProductsRequestFromInput } from "./discount-urls.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"

export interface NormalizedDiscountProduct {
  readonly available: boolean
  readonly brand?: string
  readonly discountPrice: Money
  readonly name: string
  readonly packSizeDescription?: string
  readonly productId: string
  readonly promoUnitPrice?: UnitPrice
  readonly promotionSummary?: string
  readonly promotions: ReadonlyArray<RawPromotionMetadata>
  readonly regularPrice: Money
  readonly retailerProductId: string
  readonly savingsAmount: number
  readonly savingsPercent: number
  readonly savingsPrice: Money
  readonly sourceGroupName?: string
  readonly sourceGroupType: string
  readonly unitPrice?: UnitPrice
}

export interface DiscountScanMetadata {
  readonly exhausted: boolean
  readonly matchedProducts: number
  readonly maxPages: number
  readonly nextPageToken?: string
  readonly pagesScanned: number
  readonly requestedPageSize: number
  readonly returnedProducts: number
  readonly startedPageToken?: string
}

export interface DiscountedProductsPagination {
  readonly nextPageToken?: string
  readonly totalProducts?: number
}

export interface NormalizedDiscountedProductsResult {
  readonly pagination: DiscountedProductsPagination
  readonly products: ReadonlyArray<NormalizedDiscountProduct>
  readonly scan: DiscountScanMetadata
}

export type DiscountedProductsResponseNormalizationError = {
  readonly _tag: "DiscountedProductsResponseSchemaMismatch"
  readonly message: string
}

export type GetDiscountedProductsError = DiscountedProductsRequestError | VoilaSdkError

export type GetDiscountedProductsResult = VoilaJsonResult<NormalizedDiscountedProductsResult>

const centsPerDollar = 100
const percentMultiplier = 100
const noPagesScanned = 0
const defaultDiscountSort: DiscountSort = "best-percent"

const discountedProductsResponseSchemaMismatch = (): DiscountedProductsResponseNormalizationError => ({
  _tag: "DiscountedProductsResponseSchemaMismatch",
  message: "Voila discounted products response does not match the SDK schema"
})

const moneyAmount = (money: Money): number | undefined => {
  const amount = Number(money.amount)

  return Number.isFinite(amount) ? amount : undefined
}

const roundCurrency = (amount: number): number => Math.round(amount * centsPerDollar) / centsPerDollar

const roundPercent = (amount: number): number => Math.round(amount * percentMultiplier) / percentMultiplier

const moneyFromAmount = (amount: number, currency: string): Money => ({
  amount: roundCurrency(amount).toFixed(2),
  currency
})

const firstPromotionSummary = (promotions: ReadonlyArray<RawPromotionMetadata>): string | undefined => {
  for (const promotion of promotions) {
    const summaries = [
      promotion.label,
      promotion.name,
      promotion.description,
      promotion.type
    ]

    for (const summary of summaries) {
      if (summary !== undefined && summary.trim().length > 0) {
        return summary
      }
    }
  }

  return undefined
}

const matchesQuery = (product: RawPromotionProduct, query: string | undefined): boolean => {
  if (query === undefined) {
    return true
  }

  const normalizedQuery = query.toLocaleLowerCase()
  const searchable = [
    product.name,
    product.brand ?? "",
    product.retailerProductId,
    product.packSizeDescription ?? "",
    ...((product.promotions ?? []).map((promotion) =>
      `${promotion.label ?? ""} ${promotion.name ?? ""} ${promotion.description ?? ""}`
    ))
  ].join(" ").toLocaleLowerCase()

  return searchable.includes(normalizedQuery)
}

const passesThreshold = (
  savingsAmount: number,
  savingsPercent: number,
  input: DiscountedProductsInput
): boolean =>
  savingsAmount >= (input.minSavingsAmount ?? DEFAULT_MIN_SAVINGS_AMOUNT)
  || savingsPercent >= (input.minSavingsPercent ?? DEFAULT_MIN_SAVINGS_PERCENT)

const normalizeProduct = (
  product: RawPromotionProduct,
  sourceGroup: PromotionProductsResponse["productGroups"][number],
  input: DiscountedProductsInput
): NormalizedDiscountProduct | undefined => {
  if (product.promoPrice === undefined) {
    return undefined
  }

  const regularAmount = moneyAmount(product.price)
  const discountAmount = moneyAmount(product.promoPrice)

  if (regularAmount === undefined || discountAmount === undefined || regularAmount <= discountAmount) {
    return undefined
  }

  const savingsAmount = roundCurrency(regularAmount - discountAmount)
  const savingsPercent = roundPercent((savingsAmount / regularAmount) * percentMultiplier)

  if (!passesThreshold(savingsAmount, savingsPercent, input) || !matchesQuery(product, input.query)) {
    return undefined
  }

  const promotions = product.promotions ?? []
  const promotionSummary = firstPromotionSummary(promotions)

  return {
    available: product.available,
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    discountPrice: product.promoPrice,
    name: product.name,
    ...(product.packSizeDescription === undefined ? {} : { packSizeDescription: product.packSizeDescription }),
    productId: product.productId,
    ...(product.promoUnitPrice === undefined ? {} : { promoUnitPrice: product.promoUnitPrice }),
    ...(promotionSummary === undefined ? {} : { promotionSummary }),
    promotions,
    regularPrice: product.price,
    retailerProductId: product.retailerProductId,
    savingsAmount,
    savingsPercent,
    savingsPrice: moneyFromAmount(savingsAmount, product.price.currency),
    ...(sourceGroup.name === undefined ? {} : { sourceGroupName: sourceGroup.name }),
    sourceGroupType: sourceGroup.type,
    ...(product.unitPrice === undefined ? {} : { unitPrice: product.unitPrice })
  }
}

const normalizeResponseProducts = (
  response: PromotionProductsResponse,
  input: DiscountedProductsInput
): ReadonlyArray<NormalizedDiscountProduct> =>
  response.productGroups.flatMap((group) =>
    [
      ...(group.decoratedProducts ?? []),
      ...(group.products ?? [])
    ].flatMap((product) => {
      const normalized = normalizeProduct(product, group, input)

      return normalized === undefined ? [] : [normalized]
    })
  )

const compareDiscountProducts = (
  sort: DiscountSort,
  left: NormalizedDiscountProduct,
  right: NormalizedDiscountProduct
): number => {
  switch (sort) {
    case "best-amount":
      return right.savingsAmount - left.savingsAmount
    case "best-percent":
      return right.savingsPercent - left.savingsPercent
    case "price-asc":
      return Number(left.discountPrice.amount) - Number(right.discountPrice.amount)
  }
}

const sortDiscountProducts = (
  products: ReadonlyArray<NormalizedDiscountProduct>,
  sort: DiscountSort
): ReadonlyArray<NormalizedDiscountProduct> =>
  [...products].sort((left, right) => compareDiscountProducts(sort, left, right))

export const normalizeDiscountedProductsResponse = (
  response: PromotionProductsResponse,
  input: DiscountedProductsInput,
  scan: DiscountScanMetadata
): NormalizedDiscountedProductsResult => {
  const sorted = sortDiscountProducts(normalizeResponseProducts(response, input), input.sort ?? defaultDiscountSort)
  const products = input.query !== undefined && sorted.length > input.pageSize
    ? sorted
    : sorted.slice(0, input.pageSize)

  return {
    pagination: {
      ...(scan.nextPageToken === undefined ? {} : { nextPageToken: scan.nextPageToken }),
      ...(response.totalProducts === undefined ? {} : { totalProducts: response.totalProducts })
    },
    products,
    scan: {
      ...scan,
      matchedProducts: sorted.length,
      returnedProducts: products.length
    }
  }
}

export const parseDiscountedProductsResponse = (
  input: unknown,
  requestInput: DiscountedProductsInput
): Either.Either<NormalizedDiscountedProductsResult, DiscountedProductsResponseNormalizationError> =>
  Either.map(
    Either.mapLeft(parseUnknown(PromotionProductsResponseSchema, input), discountedProductsResponseSchemaMismatch),
    (response) =>
      normalizeDiscountedProductsResponse(response, requestInput, {
        exhausted: response.nextPageToken === undefined,
        matchedProducts: noPagesScanned,
        maxPages: 1,
        ...(response.nextPageToken === undefined ? {} : { nextPageToken: response.nextPageToken }),
        pagesScanned: 1,
        requestedPageSize: requestInput.pageSize,
        returnedProducts: noPagesScanned,
        ...(requestInput.pageToken === undefined ? {} : { startedPageToken: requestInput.pageToken })
      })
  )

const makePageInput = (input: DiscountedProductsInput, pageToken: string | undefined): DiscountedProductsInput => ({
  ...input,
  ...(pageToken === undefined ? {} : { pageToken })
})

const makeScanMetadata = (
  input: DiscountedProductsInput,
  pagesScanned: number,
  maxPages: number,
  nextPageToken: string | undefined
): DiscountScanMetadata => ({
  exhausted: nextPageToken === undefined,
  matchedProducts: noPagesScanned,
  maxPages,
  ...(nextPageToken === undefined ? {} : { nextPageToken }),
  pagesScanned,
  requestedPageSize: input.pageSize,
  returnedProducts: noPagesScanned,
  ...(input.pageToken === undefined ? {} : { startedPageToken: input.pageToken })
})

export const getDiscountedProducts = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetDiscountedProductsResult, GetDiscountedProductsError>> => {
  const parsed = Either.mapLeft(
    parseUnknown(DiscountedProductsInputSchema, input),
    (): DiscountedProductsRequestError => ({
      _tag: "DiscountedProductsInputInvalid",
      message: "Discounted products input does not match the SDK schema"
    })
  )

  if (Either.isLeft(parsed)) {
    return Either.left(parsed.left)
  }

  const maxPages = parsed.right.query === undefined ? 1 : MAX_DISCOUNT_QUERY_SCAN_PAGES
  let currentSession = session
  let pageToken = parsed.right.pageToken
  let response: PromotionProductsResponse = {
    productGroups: []
  }
  let pagesScanned = noPagesScanned

  while (pagesScanned < maxPages) {
    const pageInput = makePageInput(parsed.right, pageToken)
    const request = makeDiscountedProductsRequestFromInput(pageInput)

    const page = await requestVoilaJson(
      PromotionProductsResponseSchema,
      currentSession,
      request,
      transport,
      cookieJarPort
    )

    if (Either.isLeft(page)) {
      return Either.left(page.left)
    }

    pagesScanned += 1
    currentSession = page.right.session
    response = {
      ...page.right.value,
      productGroups: [
        ...response.productGroups,
        ...page.right.value.productGroups
      ]
    }
    pageToken = page.right.value.nextPageToken

    const matchedProducts = normalizeResponseProducts(response, parsed.right).length

    if (pageToken === undefined || matchedProducts >= parsed.right.pageSize) {
      break
    }
  }

  const scan = makeScanMetadata(parsed.right, pagesScanned, maxPages, pageToken)

  return Either.right({
    session: currentSession,
    value: normalizeDiscountedProductsResponse(response, parsed.right, scan)
  })
}
