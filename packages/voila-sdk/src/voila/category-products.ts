import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type CategoryPageFilter,
  type CategoryPageSummary,
  type CategoryProductPageResponse,
  CategoryProductPageResponseSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { NormalizedSearchProduct, SearchPagination } from "./catalog-search.js"
import { normalizeSearchResponse } from "./catalog-search.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type { CategoryProductsRequestError } from "./urls.js"
import { makeCategoryProductsRequest } from "./urls.js"

export interface NormalizedCategoryProductsResult {
  readonly category: CategoryPageSummary
  readonly filters: ReadonlyArray<CategoryPageFilter>
  readonly pagination: SearchPagination
  readonly products: ReadonlyArray<NormalizedSearchProduct>
}

export type CategoryProductsResponseNormalizationError = {
  readonly _tag: "CategoryProductsResponseSchemaMismatch"
  readonly message: string
}

export type GetCategoryProductsError = CategoryProductsRequestError | VoilaSdkError

export type GetCategoryProductsResult = VoilaJsonResult<NormalizedCategoryProductsResult>

const categoryProductsResponseSchemaMismatch = (): CategoryProductsResponseNormalizationError => ({
  _tag: "CategoryProductsResponseSchemaMismatch",
  message: "Voila category products response does not match the SDK schema"
})

export const normalizeCategoryProductsResponse = (
  response: CategoryProductPageResponse
): NormalizedCategoryProductsResult => {
  const searchResult = normalizeSearchResponse(response)

  return {
    category: response.category,
    filters: response.filters ?? [],
    pagination: searchResult.pagination,
    products: searchResult.products
  }
}

export const parseCategoryProductsResponse = (
  input: unknown
): Result.Result<NormalizedCategoryProductsResult, CategoryProductsResponseNormalizationError> =>
  Result.map(
    Result.mapError(parseUnknown(CategoryProductPageResponseSchema, input), categoryProductsResponseSchemaMismatch),
    normalizeCategoryProductsResponse
  )

export const getCategoryProducts = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetCategoryProductsResult, GetCategoryProductsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeCategoryProductsRequest(input)), (request) =>
    Effect.map(requestVoilaJson(CategoryProductPageResponseSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeCategoryProductsResponse(result.value)
    }))
  )
