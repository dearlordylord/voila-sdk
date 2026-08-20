import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type NormalizedSearchResult,
  NormalizedSearchResultSchema,
  type ProductSearchResponse,
  ProductSearchResponseSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type { SearchRequestError } from "./urls.js"
import { makeSearchRequest } from "./urls.js"

export type SearchResponseNormalizationError = {
  readonly _tag: "SearchResponseSchemaMismatch"
  readonly message: string
}

export type SearchProductsError = SearchRequestError | SearchResponseNormalizationError | VoilaSdkError

export type SearchProductsResult = VoilaJsonResult<NormalizedSearchResult>

const searchResponseSchemaMismatch = (): SearchResponseNormalizationError => ({
  _tag: "SearchResponseSchemaMismatch",
  message: "Voila search response does not match the SDK schema"
})

const projectGroupProducts = (group: ProductSearchResponse["productGroups"][number]) => {
  const products = [...(group.decoratedProducts ?? []), ...(group.products ?? [])]

  return products.map((product) => ({
    ...product,
    ...(group.name === undefined ? {} : { sourceGroupName: group.name }),
    sourceGroupType: group.type
  }))
}

const projectSearchResponse = (response: ProductSearchResponse) => ({
  pagination: {
    ...(response.nextPageToken === undefined ? {} : { nextPageToken: response.nextPageToken }),
    ...(response.totalProducts === undefined ? {} : { totalProducts: response.totalProducts })
  },
  products: response.productGroups.flatMap(projectGroupProducts)
})

export const normalizeSearchResponse = (
  response: ProductSearchResponse
): Result.Result<NormalizedSearchResult, SearchResponseNormalizationError> =>
  Result.mapError(
    parseUnknown(NormalizedSearchResultSchema, projectSearchResponse(response)),
    searchResponseSchemaMismatch
  )

export const parseSearchResponse = (
  input: unknown
): Result.Result<NormalizedSearchResult, SearchResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(ProductSearchResponseSchema, input), searchResponseSchemaMismatch),
    normalizeSearchResponse
  )

export const searchProducts = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<SearchProductsResult, SearchProductsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeSearchRequest(input)), (request) =>
    Effect.flatMap(requestVoilaJson(ProductSearchResponseSchema, session, request, cookieJarPort), (result) =>
      Effect.map(Effect.fromResult(normalizeSearchResponse(result.value)), (value) => ({
        session: result.session,
        value
      }))
    )
  )
