import { Result } from "effect"

import { parseUnknown } from "./parse.js"
import type { CartQuantityDelta } from "./schemas/index.js"
import { CartQuantityDeltaSchema } from "./schemas/index.js"

export type CartQuantityDeltaError = { readonly _tag: "CartQuantityDeltaInvalid"; readonly message: string }

const cartQuantityDeltaInvalid = (): CartQuantityDeltaError => ({
  _tag: "CartQuantityDeltaInvalid",
  message: "Cart quantity delta does not match the SDK schema"
})

export const makeCartQuantityDelta = (
  productId: string,
  quantity: number
): Result.Result<CartQuantityDelta, CartQuantityDeltaError> =>
  Result.mapError(parseUnknown(CartQuantityDeltaSchema, { productId, quantity }), cartQuantityDeltaInvalid)

export const makeAddToCartDelta = (
  productId: string,
  quantity: number
): Result.Result<CartQuantityDelta, CartQuantityDeltaError> => makeCartQuantityDelta(productId, Math.abs(quantity))

export const makeRemoveFromCartDelta = (
  productId: string,
  quantity: number
): Result.Result<CartQuantityDelta, CartQuantityDeltaError> => makeCartQuantityDelta(productId, -Math.abs(quantity))
