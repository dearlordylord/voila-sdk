import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type CategoryProductPageResponse,
  CategoryProductPageResponseSchema,
  NormalizedCategoryProductsResultSchema,
  type NormalizedCategoryProductsResult,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import { normalizeSearchResponse } from "./catalog-search.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type { CategoryProductsRequestError } from "./urls.js"
import { makeCategoryProductsRequest } from "./urls.js"

export type CategoryProductsResponseNormalizationError = {
  readonly _tag: "CategoryProductsResponseSchemaMismatch"
  readonly message: string
}

export type GetCategoryProductsError =
  | CategoryProductsRequestError
  | CategoryProductsResponseNormalizationError
  | VoilaSdkError

export type GetCategoryProductsResult = VoilaJsonResult<NormalizedCategoryProductsResult>

const categoryProductsResponseSchemaMismatch = (): CategoryProductsResponseNormalizationError => ({
  _tag: "CategoryProductsResponseSchemaMismatch",
  message: "Voila category products response does not match the SDK schema"
})

export const normalizeCategoryProductsResponse = (
  response: CategoryProductPageResponse
): Result.Result<NormalizedCategoryProductsResult, CategoryProductsResponseNormalizationError> => {
  return Result.flatMap(
    Result.mapError(normalizeSearchResponse(response), categoryProductsResponseSchemaMismatch),
    (searchResult) =>
      Result.mapError(
        parseUnknown(NormalizedCategoryProductsResultSchema, {
          category: response.category,
          filters: response.filters ?? [],
          pagination: searchResult.pagination,
          products: searchResult.products
        }),
        categoryProductsResponseSchemaMismatch
      )
  )
}

export const parseCategoryProductsResponse = (
  input: unknown
): Result.Result<NormalizedCategoryProductsResult, CategoryProductsResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(CategoryProductPageResponseSchema, input), categoryProductsResponseSchemaMismatch),
    normalizeCategoryProductsResponse
  )

export const getCategoryProducts = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetCategoryProductsResult, GetCategoryProductsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeCategoryProductsRequest(input)), (request) =>
    Effect.flatMap(requestVoilaJson(CategoryProductPageResponseSchema, session, request, cookieJarPort), (result) =>
      Effect.map(
        Effect.fromResult(parseCategoryProductsResponse(result.value)),
        (value: NormalizedCategoryProductsResult) => ({ session: result.session, value })
      )
    )
  )
