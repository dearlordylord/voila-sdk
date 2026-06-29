import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import { type DiscountedProductsInput, DiscountedProductsInputSchema } from "../domain/schemas/index.js"
import { VOILA_BASE_URL } from "./urls.js"

const PROMOTIONS_PATH = "/api/product-listing-pages/v1/pages/promotions"
const TAG_WEB = "web"

export interface DiscountedProductsRequest {
  readonly method: "GET"
  readonly url: URL
}

export type DiscountedProductsRequestError = {
  readonly _tag: "DiscountedProductsInputInvalid"
  readonly message: string
}

const discountedProductsInputInvalid = (): DiscountedProductsRequestError => ({
  _tag: "DiscountedProductsInputInvalid",
  message: "Discounted products input does not match the SDK schema"
})

const buildDiscountedProductsUrl = (input: DiscountedProductsInput): URL => {
  const url = new URL(PROMOTIONS_PATH, VOILA_BASE_URL)
  url.searchParams.set("tag", TAG_WEB)
  url.searchParams.set("includeAdditionalPageInfo", "true")
  url.searchParams.set("maxProductsToDecorate", String(input.pageSize))
  url.searchParams.set("maxPageSize", String(input.pageSize))

  if (input.pageToken !== undefined) {
    url.searchParams.set("pageToken", input.pageToken)
  }

  if (input.categoryId !== undefined) {
    url.searchParams.set("categoryId", input.categoryId)
  }

  if (input.retailerCategoryId !== undefined) {
    url.searchParams.set("retailerCategoryId", input.retailerCategoryId)
  }

  return url
}

export const makeDiscountedProductsRequest = (
  input: unknown
): Either.Either<DiscountedProductsRequest, DiscountedProductsRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(DiscountedProductsInputSchema, input), discountedProductsInputInvalid),
    makeDiscountedProductsRequestFromInput
  )

export const makeDiscountedProductsRequestFromInput = (
  input: DiscountedProductsInput
): DiscountedProductsRequest => ({
  method: "GET",
  url: buildDiscountedProductsUrl(input)
})
