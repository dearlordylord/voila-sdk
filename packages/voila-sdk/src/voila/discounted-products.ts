import { Effect, Match, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  DEFAULT_MIN_SAVINGS_AMOUNT,
  DEFAULT_MIN_SAVINGS_PERCENT,
  type DiscountScanMetadata,
  type DiscountedProductsInput,
  DiscountedProductsInputSchema,
  type DiscountSort,
  MAX_DISCOUNT_QUERY_SCAN_PAGES,
  type NormalizedDiscountedProductsResult,
  NormalizedDiscountedProductsResultSchema,
  type Money,
  type PromotionProductsResponse,
  PromotionProductsResponseSchema,
  type RawPromotionMetadata,
  type RawPromotionProduct,
  type SessionSnapshot,
  type PageToken,
  PageTokenSchema
} from "../domain/schemas/index.js"
import { makeDiscountedProductsRequest, type DiscountedProductsRequestError } from "./discount-urls.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"

export type DiscountedProductsResponseNormalizationError = {
  readonly _tag: "DiscountedProductsResponseSchemaMismatch"
  readonly message: string
}

export type GetDiscountedProductsError =
  | DiscountedProductsRequestError
  | DiscountedProductsResponseNormalizationError
  | VoilaSdkError

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
    const summaries = [promotion.label, promotion.name, promotion.description, promotion.type]

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
    ...(product.promotions ?? []).map(
      (promotion) => `${promotion.label ?? ""} ${promotion.name ?? ""} ${promotion.description ?? ""}`
    )
  ]
    .join(" ")
    .toLocaleLowerCase()

  return searchable.includes(normalizedQuery)
}

const passesThreshold = (savingsAmount: number, savingsPercent: number, input: DiscountedProductsInput): boolean =>
  savingsAmount >= (input.minSavingsAmount ?? DEFAULT_MIN_SAVINGS_AMOUNT) ||
  savingsPercent >= (input.minSavingsPercent ?? DEFAULT_MIN_SAVINGS_PERCENT)

const normalizeProduct = (
  product: RawPromotionProduct,
  sourceGroup: PromotionProductsResponse["productGroups"][number],
  input: DiscountedProductsInput
) => {
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

const normalizeResponseProducts = (response: PromotionProductsResponse, input: DiscountedProductsInput) =>
  response.productGroups.flatMap((group) =>
    [...(group.decoratedProducts ?? []), ...(group.products ?? [])].flatMap((product) => {
      const normalized = normalizeProduct(product, group, input)

      return normalized === undefined ? [] : [normalized]
    })
  )

const compareDiscountProducts = (
  sort: DiscountSort,
  left: NonNullable<ReturnType<typeof normalizeProduct>>,
  right: NonNullable<ReturnType<typeof normalizeProduct>>
): number => {
  return Match.value(sort).pipe(
    Match.when("best-amount", () => right.savingsAmount - left.savingsAmount),
    Match.when("best-percent", () => right.savingsPercent - left.savingsPercent),
    Match.when("price-asc", () => Number(left.discountPrice.amount) - Number(right.discountPrice.amount)),
    Match.exhaustive
  )
}

const sortDiscountProducts = (
  products: ReadonlyArray<NonNullable<ReturnType<typeof normalizeProduct>>>,
  sort: DiscountSort
) => [...products].sort((left, right) => compareDiscountProducts(sort, left, right))

const scanNextPageToken = (scan: DiscountScanMetadata): PageToken | undefined =>
  Match.typeTags<DiscountScanMetadata>()({
    exhausted: () => undefined,
    continuable: ({ nextPageToken }) => nextPageToken
  })(scan)

export const normalizeDiscountedProductsResponse = (
  response: PromotionProductsResponse,
  input: DiscountedProductsInput,
  scan: DiscountScanMetadata
) => {
  const sorted = sortDiscountProducts(normalizeResponseProducts(response, input), input.sort ?? defaultDiscountSort)
  const products =
    input.query !== undefined && sorted.length > input.pageSize ? sorted : sorted.slice(0, input.pageSize)
  const nextPageToken = scanNextPageToken(scan)

  return {
    pagination: {
      ...(nextPageToken === undefined ? {} : { nextPageToken }),
      ...(response.totalProducts === undefined ? {} : { totalProducts: response.totalProducts })
    },
    products,
    scan: { ...scan, matchedProducts: sorted.length, returnedProducts: products.length }
  }
}

export const parseDiscountedProductsResponse = (
  input: unknown,
  requestInput: DiscountedProductsInput
): Result.Result<NormalizedDiscountedProductsResult, DiscountedProductsResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(PromotionProductsResponseSchema, input), discountedProductsResponseSchemaMismatch),
    (response) =>
      Result.flatMap(
        response.nextPageToken === undefined
          ? Result.succeed<PageToken | undefined>(undefined)
          : Result.mapError(
              parseUnknown(PageTokenSchema, response.nextPageToken),
              discountedProductsResponseSchemaMismatch
            ),
        (nextPageToken) =>
          Result.mapError(
            parseUnknown(
              NormalizedDiscountedProductsResultSchema,
              normalizeDiscountedProductsResponse(response, requestInput, {
                ...makeScanMetadata(requestInput, 1, 1, nextPageToken)
              })
            ),
            discountedProductsResponseSchemaMismatch
          )
      )
  )

const makePageInput = (input: DiscountedProductsInput, pageToken: PageToken | undefined): unknown => ({
  ...input,
  ...(pageToken === undefined ? {} : { pageToken })
})

const makeScanMetadata = (
  input: DiscountedProductsInput,
  pagesScanned: number,
  maxPages: number,
  nextPageToken: PageToken | undefined
): DiscountScanMetadata => {
  const common = {
    matchedProducts: noPagesScanned,
    maxPages,
    pagesScanned,
    requestedPageSize: input.pageSize,
    returnedProducts: noPagesScanned,
    ...(input.pageToken === undefined ? {} : { startedPageToken: input.pageToken })
  }

  return nextPageToken === undefined
    ? { _tag: "exhausted", ...common }
    : { _tag: "continuable", nextPageToken, ...common }
}

/**
 * Where one query's page scan has got to. `done` is carried rather than
 * recomputed because the stop condition is about the page that just arrived —
 * a scan stops when the last page had no successor or when enough matches have
 * accumulated, and neither is derivable from the accumulated response alone.
 */
interface DiscountScanState {
  readonly done: boolean
  readonly pageToken: PageToken | undefined
  readonly pagesScanned: number
  readonly response: PromotionProductsResponse
  readonly session: SessionSnapshot
}

const runDiscountScan = (
  initial: DiscountScanState,
  body: (state: DiscountScanState) => Effect.Effect<DiscountScanState, GetDiscountedProductsError, VoilaTransport>,
  shouldContinue: (state: DiscountScanState) => boolean
): Effect.Effect<DiscountScanState, GetDiscountedProductsError, VoilaTransport> => {
  const loop = (
    state: DiscountScanState
  ): Effect.Effect<DiscountScanState, GetDiscountedProductsError, VoilaTransport> =>
    shouldContinue(state) ? Effect.flatMap(body(state), loop) : Effect.succeed(state)

  return loop(initial)
}

const discountInputInvalid = (): DiscountedProductsRequestError => ({
  _tag: "DiscountedProductsInputInvalid",
  message: "Discounted products input does not match the SDK schema"
})

const scanNextPage = (
  state: DiscountScanState,
  input: DiscountedProductsInput,
  cookieJarPort?: CookieJarPort
): Effect.Effect<DiscountScanState, GetDiscountedProductsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeDiscountedProductsRequest(makePageInput(input, state.pageToken))), (request) =>
    Effect.flatMap(requestVoilaJson(PromotionProductsResponseSchema, state.session, request, cookieJarPort), (page) =>
      Effect.map(
        Effect.fromResult(
          page.value.nextPageToken === undefined
            ? Result.succeed<PageToken | undefined>(undefined)
            : Result.mapError(
                parseUnknown(PageTokenSchema, page.value.nextPageToken),
                discountedProductsResponseSchemaMismatch
              )
        ),
        (pageToken) => {
          const response = {
            ...page.value,
            productGroups: [...state.response.productGroups, ...page.value.productGroups]
          }

          return {
            done: pageToken === undefined || normalizeResponseProducts(response, input).length >= input.pageSize,
            pageToken,
            pagesScanned: state.pagesScanned + 1,
            response,
            session: page.session
          }
        }
      )
    )
  )

export const getDiscountedProducts = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetDiscountedProductsResult, GetDiscountedProductsError, VoilaTransport> =>
  Effect.flatMap(
    Effect.fromResult(Result.mapError(parseUnknown(DiscountedProductsInputSchema, input), discountInputInvalid)),
    (parsed) => {
      const maxPages = parsed.query === undefined ? 1 : MAX_DISCOUNT_QUERY_SCAN_PAGES
      const initial: DiscountScanState = {
        done: false,
        pageToken: parsed.pageToken,
        pagesScanned: noPagesScanned,
        response: { productGroups: [] },
        session
      }

      return Effect.flatMap(
        runDiscountScan(
          initial,
          (state) => scanNextPage(state, parsed, cookieJarPort),
          (state) => !state.done && state.pagesScanned < maxPages
        ),
        (state) =>
          Effect.map(
            Effect.fromResult(
              Result.mapError(
                parseUnknown(
                  NormalizedDiscountedProductsResultSchema,
                  normalizeDiscountedProductsResponse(
                    state.response,
                    parsed,
                    makeScanMetadata(parsed, state.pagesScanned, maxPages, state.pageToken)
                  )
                ),
                discountedProductsResponseSchemaMismatch
              )
            ),
            (value) => ({ session: state.session, value })
          )
      )
    }
  )
