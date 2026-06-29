import { Either } from "effect"

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
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
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
): Either.Either<NormalizedCategoryProductsResult, CategoryProductsResponseNormalizationError> =>
  Either.map(
    Either.mapLeft(parseUnknown(CategoryProductPageResponseSchema, input), categoryProductsResponseSchemaMismatch),
    normalizeCategoryProductsResponse
  )

export const getCategoryProducts = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetCategoryProductsResult, GetCategoryProductsError>> => {
  const request = makeCategoryProductsRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    CategoryProductPageResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeCategoryProductsResponse(result.value)
  }))
}
