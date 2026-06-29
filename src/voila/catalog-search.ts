import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type Product,
  type ProductSearchResponse,
  ProductSearchResponseSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { SearchRequestError } from "./urls.js"
import { makeSearchRequest } from "./urls.js"

export interface NormalizedSearchProduct extends Product {
  readonly sourceGroupName?: string
  readonly sourceGroupType: string
}

export interface SearchPagination {
  readonly nextPageToken?: string
  readonly totalProducts?: number
}

export interface NormalizedSearchResult {
  readonly pagination: SearchPagination
  readonly products: ReadonlyArray<NormalizedSearchProduct>
}

export type SearchResponseNormalizationError = {
  readonly _tag: "SearchResponseSchemaMismatch"
  readonly message: string
}

export type SearchProductsError = SearchRequestError | VoilaSdkError

export type SearchProductsResult = VoilaJsonResult<NormalizedSearchResult>

const searchResponseSchemaMismatch = (): SearchResponseNormalizationError => ({
  _tag: "SearchResponseSchemaMismatch",
  message: "Voila search response does not match the SDK schema"
})

const normalizeGroupProducts = (
  group: ProductSearchResponse["productGroups"][number]
): ReadonlyArray<NormalizedSearchProduct> => {
  const products = [
    ...(group.decoratedProducts ?? []),
    ...(group.products ?? [])
  ]

  return products.map((product) => ({
    ...product,
    ...(group.name === undefined ? {} : { sourceGroupName: group.name }),
    sourceGroupType: group.type
  }))
}

export const normalizeSearchResponse = (
  response: ProductSearchResponse
): NormalizedSearchResult => ({
  pagination: {
    ...(response.nextPageToken === undefined ? {} : { nextPageToken: response.nextPageToken }),
    ...(response.totalProducts === undefined ? {} : { totalProducts: response.totalProducts })
  },
  products: response.productGroups.flatMap(normalizeGroupProducts)
})

export const parseSearchResponse = (
  input: unknown
): Either.Either<NormalizedSearchResult, SearchResponseNormalizationError> =>
  Either.map(
    Either.mapLeft(parseUnknown(ProductSearchResponseSchema, input), searchResponseSchemaMismatch),
    normalizeSearchResponse
  )

export const searchProducts = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<SearchProductsResult, SearchProductsError>> => {
  const request = makeSearchRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(ProductSearchResponseSchema, session, request.right, transport, cookieJarPort)

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeSearchResponse(result.value)
  }))
}
