import { Result, Schema } from "effect"

import { parseUnknown } from "../domain/parse.js"
import type {
  ActiveShoppingContextInput,
  ApplyDeliveryContextChangeInput,
  CategoryPageInput,
  DeliveryDestinationsInput,
  DeliveryPropositionDetailsInput,
  SearchInput
} from "../domain/schemas/index.js"
import {
  ActiveShoppingContextInputSchema,
  ApplyDeliveryContextChangeInputSchema,
  CartQuantityDeltaSchema,
  CategoryPageInputSchema,
  DeliveryContextPreviewInputSchema,
  DeliveryDestinationByIdInputSchema,
  DeliveryDestinationsInputSchema,
  DeliveryPropositionDetailsInputSchema,
  SearchInputSchema,
  SetActiveCartPropositionInputSchema,
  SetActiveDeliveryDestinationInputSchema
} from "../domain/schemas/index.js"

export const VOILA_BASE_URL = "https://voila.ca"
const SEARCH_PATH = "/api/webproductpagews/v6/product-pages/search"
const CATEGORY_PRODUCTS_PATH = "/api/webproductpagews/v6/product-pages"
const CART_APPLY_QUANTITY_PATH = "/api/cart/v1/carts/active/apply-quantity"
const CART_VIEW_PATH = "/api/cart/v2/carts/active/cart-view"
const ACTIVE_CUSTOMER_SESSION_PATH = "/api/customersessions/v2/sessions/active"
const CUSTOMER_SESSION_PROPOSITION_PATH = "/api/customersessions/v2/sessions/proposition"
const DELIVERY_DESTINATIONS_PATH = "/api/ecomdeliverydestinations/v4/delivery-addresses"
const DELIVERY_PROPOSITIONS_PATH = "/api/ecomdeliverydestinations/v1/propositions"
const TAG_WEB = "web"
const filterSeparator = ":"
const CartQuantityDeltaArraySchema = Schema.Array(CartQuantityDeltaSchema).pipe(Schema.check(Schema.isMinLength(1)))

export interface SearchRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface CategoryProductsRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface CartViewRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface ActiveCustomerSessionRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface ActiveShoppingContextRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface DeliveryPropositionDetailsRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface DeliveryContextPreviewRequest {
  readonly body: string
  readonly method: "POST"
  readonly url: URL
}

export interface SetActiveDeliveryDestinationRequest {
  readonly body: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: "PUT"
  readonly url: URL
}

export interface SetActiveCartPropositionRequest {
  readonly body: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: "POST"
  readonly url: URL
}

interface AccountContextHeadersInput {
  readonly customerId?: string
  readonly visitorId?: string
}

export interface DeliveryDestinationsRequest {
  readonly method: "GET"
  readonly url: URL
}

export interface DeliveryDestinationRequest {
  readonly method: "GET"
  readonly url: URL
}

export type SearchRequestError = { readonly _tag: "SearchInputInvalid"; readonly message: string }

export type CategoryProductsRequestError = { readonly _tag: "CategoryPageInputInvalid"; readonly message: string }

export type CartQuantityRequestError = { readonly _tag: "CartQuantityInputInvalid"; readonly message: string }

export type DeliveryDestinationsRequestError = {
  readonly _tag: "DeliveryDestinationsInputInvalid"
  readonly message: string
}

export type DeliveryDestinationRequestError = {
  readonly _tag: "DeliveryDestinationInputInvalid"
  readonly message: string
}

export type ActiveShoppingContextRequestError = {
  readonly _tag: "ActiveShoppingContextInputInvalid"
  readonly message: string
}

export type DeliveryPropositionDetailsRequestError = {
  readonly _tag: "DeliveryPropositionDetailsInputInvalid"
  readonly message: string
}

export type DeliveryContextPreviewRequestError = {
  readonly _tag: "DeliveryContextPreviewInputInvalid"
  readonly message: string
}

export type SetActiveDeliveryDestinationRequestError = {
  readonly _tag: "SetActiveDeliveryDestinationInputInvalid"
  readonly message: string
}

export type SetActiveCartPropositionRequestError = {
  readonly _tag: "SetActiveCartPropositionInputInvalid"
  readonly message: string
}

export type ApplyDeliveryContextChangeRequestError = {
  readonly _tag: "ApplyDeliveryContextChangeInputInvalid"
  readonly message: string
}

const searchInputInvalid = (): SearchRequestError => ({
  _tag: "SearchInputInvalid",
  message: "Search input does not match the SDK schema"
})

const categoryPageInputInvalid = (): CategoryProductsRequestError => ({
  _tag: "CategoryPageInputInvalid",
  message: "Category page input does not match the SDK schema"
})

const cartQuantityInputInvalid = (): CartQuantityRequestError => ({
  _tag: "CartQuantityInputInvalid",
  message: "Cart quantity request input does not match the SDK schema"
})

const deliveryDestinationsInputInvalid = (): DeliveryDestinationsRequestError => ({
  _tag: "DeliveryDestinationsInputInvalid",
  message: "Delivery destinations request input does not match the SDK schema"
})

const deliveryDestinationInputInvalid = (): DeliveryDestinationRequestError => ({
  _tag: "DeliveryDestinationInputInvalid",
  message: "Delivery destination request input does not match the SDK schema"
})

const activeShoppingContextInputInvalid = (): ActiveShoppingContextRequestError => ({
  _tag: "ActiveShoppingContextInputInvalid",
  message: "Active shopping context request input does not match the SDK schema"
})

const deliveryPropositionDetailsInputInvalid = (): DeliveryPropositionDetailsRequestError => ({
  _tag: "DeliveryPropositionDetailsInputInvalid",
  message: "Delivery proposition details request input does not match the SDK schema"
})

const deliveryContextPreviewInputInvalid = (): DeliveryContextPreviewRequestError => ({
  _tag: "DeliveryContextPreviewInputInvalid",
  message: "Delivery context preview request input does not match the SDK schema"
})

const setActiveDeliveryDestinationInputInvalid = (): SetActiveDeliveryDestinationRequestError => ({
  _tag: "SetActiveDeliveryDestinationInputInvalid",
  message: "Set active delivery destination request input does not match the SDK schema"
})

const setActiveCartPropositionInputInvalid = (): SetActiveCartPropositionRequestError => ({
  _tag: "SetActiveCartPropositionInputInvalid",
  message: "Set active cart proposition request input does not match the SDK schema"
})

const applyDeliveryContextChangeInputInvalid = (): ApplyDeliveryContextChangeRequestError => ({
  _tag: "ApplyDeliveryContextChangeInputInvalid",
  message: "Apply delivery context change input does not match the SDK schema"
})

const addProductPageParameters = (url: URL, input: Readonly<{ pageSize: number; pageToken?: string }>): URL => {
  url.searchParams.set("tag", TAG_WEB)
  url.searchParams.set("includeAdditionalPageInfo", "true")
  url.searchParams.set("maxProductsToDecorate", String(input.pageSize))
  url.searchParams.set("maxPageSize", String(input.pageSize))

  if (input.pageToken !== undefined) {
    url.searchParams.set("pageToken", input.pageToken)
  }

  return url
}

const buildSearchUrl = (input: SearchInput): URL => {
  const url = addProductPageParameters(new URL(SEARCH_PATH, VOILA_BASE_URL), input)
  url.searchParams.set("q", input.query)

  if (input.categoryContext !== undefined && "categoryId" in input.categoryContext) {
    url.searchParams.set("categoryId", input.categoryContext.categoryId)
  }

  if (input.categoryContext !== undefined && "retailerCategoryId" in input.categoryContext) {
    url.searchParams.set("retailerCategoryId", input.categoryContext.retailerCategoryId)
  }

  return url
}

const addCategoryProductParameters = (url: URL, input: CategoryPageInput): URL => {
  addProductPageParameters(url, input)

  if (input.categoryId !== undefined) {
    url.searchParams.set("categoryId", input.categoryId)
  }

  if (input.retailerCategoryId !== undefined) {
    url.searchParams.set("retailerCategoryId", input.retailerCategoryId)
  }

  for (const filter of input.filters ?? []) {
    url.searchParams.append("filter", `${filter.id}${filterSeparator}${filter.value}`)
  }

  return url
}

const buildDeliveryDestinationsUrl = (input: DeliveryDestinationsInput): URL => {
  const url = new URL(DELIVERY_DESTINATIONS_PATH, VOILA_BASE_URL)
  url.searchParams.set("deliveryMethod", input.deliveryMethod)

  return url
}

const buildActiveShoppingContextUrl = (input: ActiveShoppingContextInput): URL => {
  const url = new URL(ACTIVE_CUSTOMER_SESSION_PATH, VOILA_BASE_URL)

  if (input.regionId !== undefined) {
    url.searchParams.set("regionId", input.regionId)
  }

  return url
}

const buildDeliveryPropositionDetailsUrl = (input: DeliveryPropositionDetailsInput): URL => {
  const url = new URL(DELIVERY_PROPOSITIONS_PATH, VOILA_BASE_URL)
  url.searchParams.set("regionId", input.regionId)
  url.searchParams.set("deliveryDestinationId", input.deliveryDestinationId)

  return url
}

const makeAccountContextHeaders = (input: AccountContextHeadersInput): Readonly<Record<string, string>> | undefined => {
  const headers = {
    ...(input.visitorId === undefined ? {} : { "visitor-id": input.visitorId }),
    ...(input.customerId === undefined ? {} : { "customer-id": input.customerId })
  }

  return Object.keys(headers).length === 0 ? undefined : headers
}

export const makeSearchRequest = (input: unknown): Result.Result<SearchRequest, SearchRequestError> =>
  Result.map(Result.mapError(parseUnknown(SearchInputSchema, input), searchInputInvalid), (searchInput) => ({
    method: "GET",
    url: buildSearchUrl(searchInput)
  }))

export const makeCategoryProductsRequest = (
  input: unknown
): Result.Result<CategoryProductsRequest, CategoryProductsRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(CategoryPageInputSchema, input), categoryPageInputInvalid),
    (categoryPageInput) => ({
      method: "GET",
      url: addCategoryProductParameters(new URL(CATEGORY_PRODUCTS_PATH, VOILA_BASE_URL), categoryPageInput)
    })
  )

export const makeCartViewRequest = (): CartViewRequest => ({
  method: "GET",
  url: new URL(CART_VIEW_PATH, VOILA_BASE_URL)
})

export const makeActiveCustomerSessionRequest = (): ActiveCustomerSessionRequest => ({
  method: "GET",
  url: new URL(ACTIVE_CUSTOMER_SESSION_PATH, VOILA_BASE_URL)
})

export const makeActiveShoppingContextRequest = (
  input: unknown = {}
): Result.Result<ActiveShoppingContextRequest, ActiveShoppingContextRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(ActiveShoppingContextInputSchema, input), activeShoppingContextInputInvalid),
    (activeShoppingContextInput) => ({ method: "GET", url: buildActiveShoppingContextUrl(activeShoppingContextInput) })
  )

export const makeDeliveryDestinationsRequest = (
  input: unknown = {}
): Result.Result<DeliveryDestinationsRequest, DeliveryDestinationsRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(DeliveryDestinationsInputSchema, input), deliveryDestinationsInputInvalid),
    (deliveryDestinationsInput) => ({ method: "GET", url: buildDeliveryDestinationsUrl(deliveryDestinationsInput) })
  )

export const makeDeliveryDestinationRequest = (
  input: unknown
): Result.Result<DeliveryDestinationRequest, DeliveryDestinationRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(DeliveryDestinationByIdInputSchema, input), deliveryDestinationInputInvalid),
    ({ deliveryDestinationId }) => ({
      method: "GET",
      url: new URL(`${DELIVERY_DESTINATIONS_PATH}/${encodeURIComponent(deliveryDestinationId)}`, VOILA_BASE_URL)
    })
  )

export const makeDeliveryPropositionDetailsRequest = (
  input: unknown
): Result.Result<DeliveryPropositionDetailsRequest, DeliveryPropositionDetailsRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(DeliveryPropositionDetailsInputSchema, input), deliveryPropositionDetailsInputInvalid),
    (deliveryPropositionDetailsInput) => ({
      method: "GET",
      url: buildDeliveryPropositionDetailsUrl(deliveryPropositionDetailsInput)
    })
  )

export const makeDeliveryContextPreviewRequest = (
  input: unknown
): Result.Result<DeliveryContextPreviewRequest, DeliveryContextPreviewRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(DeliveryContextPreviewInputSchema, input), deliveryContextPreviewInputInvalid),
    (previewInput) => ({
      body: JSON.stringify({
        deliveryDestinationId: previewInput.deliveryDestinationId,
        destinationRegionId: previewInput.destinationRegionId
      }),
      method: "POST",
      url: new URL(CUSTOMER_SESSION_PROPOSITION_PATH, VOILA_BASE_URL)
    })
  )

export const makeSetActiveDeliveryDestinationRequest = (
  input: unknown
): Result.Result<SetActiveDeliveryDestinationRequest, SetActiveDeliveryDestinationRequestError> =>
  Result.map(
    Result.mapError(
      parseUnknown(SetActiveDeliveryDestinationInputSchema, input),
      setActiveDeliveryDestinationInputInvalid
    ),
    (setInput) => {
      const headers = makeAccountContextHeaders(setInput)

      return {
        body: JSON.stringify({ deliveryDestinationId: setInput.deliveryDestinationId, regionId: setInput.regionId }),
        ...(headers === undefined ? {} : { headers }),
        method: "PUT",
        url: new URL(ACTIVE_CUSTOMER_SESSION_PATH, VOILA_BASE_URL)
      }
    }
  )

export const makeSetActiveCartPropositionRequest = (
  input: unknown
): Result.Result<SetActiveCartPropositionRequest, SetActiveCartPropositionRequestError> =>
  Result.map(
    Result.mapError(parseUnknown(SetActiveCartPropositionInputSchema, input), setActiveCartPropositionInputInvalid),
    (setInput) => {
      const headers = makeAccountContextHeaders(setInput)

      return {
        body: JSON.stringify({
          destinationCartPropositionId: setInput.destinationCartPropositionId,
          originCartPropositionId: setInput.originCartPropositionId
        }),
        ...(headers === undefined ? {} : { headers }),
        method: "POST",
        url: new URL(ACTIVE_CUSTOMER_SESSION_PATH, VOILA_BASE_URL)
      }
    }
  )

export const parseApplyDeliveryContextChangeInput = (
  input: unknown
): Result.Result<ApplyDeliveryContextChangeInput, ApplyDeliveryContextChangeRequestError> =>
  Result.mapError(parseUnknown(ApplyDeliveryContextChangeInputSchema, input), applyDeliveryContextChangeInputInvalid)

export const makeApplyQuantityRequest = (
  deltas: unknown
): Result.Result<Readonly<{ body: string; method: "POST"; url: URL }>, CartQuantityRequestError> => {
  const parsedDeltas = Result.mapError(parseUnknown(CartQuantityDeltaArraySchema, deltas), cartQuantityInputInvalid)

  if (Result.isFailure(parsedDeltas)) {
    return Result.fail(parsedDeltas.failure)
  }

  const url = new URL(CART_APPLY_QUANTITY_PATH, VOILA_BASE_URL)
  url.searchParams.set("cartProductSorting", "CATEGORIES")

  return Result.succeed({ body: JSON.stringify(parsedDeltas.success), method: "POST", url })
}
