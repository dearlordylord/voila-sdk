import { Effect, Result, Schema } from "effect"

import { type CartQuantityDeltaError, makeAddToCartDelta, makeRemoveFromCartDelta } from "../domain/cart.js"
import { parseUnknown } from "../domain/parse.js"
import {
  type CartItemQuantityInput,
  CartItemQuantityInputSchema,
  type ProductUuid,
  type CartUpdateResponse,
  CartUpdateResponseSchema,
  type NormalizedCartMutationResult,
  NormalizedCartMutationResultSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type { CartQuantityRequestError } from "./urls.js"
import { makeApplyQuantityRequest } from "./urls.js"

export type CartMutationResponseNormalizationError = {
  readonly _tag: "CartMutationResponseSchemaMismatch"
  readonly message: string
}

export type ApplyCartDeltasError = CartMutationResponseNormalizationError | CartQuantityRequestError | VoilaSdkError

export type ApplyCartDeltasResult = VoilaJsonResult<NormalizedCartMutationResult>

export type CartItemsInputError = { readonly _tag: "CartItemsInputInvalid"; readonly message: string }

export type CartItemsOperationError = ApplyCartDeltasError | CartItemsInputError | CartQuantityDeltaError

const CartItemQuantityInputArraySchema = Schema.Array(CartItemQuantityInputSchema)

const cartItemsInputInvalid = (): CartItemsInputError => ({
  _tag: "CartItemsInputInvalid",
  message: "Cart item input does not match the SDK schema"
})

const cartMutationResponseSchemaMismatch = (): CartMutationResponseNormalizationError => ({
  _tag: "CartMutationResponseSchemaMismatch",
  message: "Voila cart mutation response does not match the SDK schema"
})

const countCartItems = (response: CartUpdateResponse): number =>
  (response.basketUpdateResult.itemGroups ?? []).reduce(
    (total, group) => total + group.items.reduce((groupTotal, item) => groupTotal + item.quantity, 0),
    0
  )

const projectCartMutationResponse = (response: CartUpdateResponse) => ({
  itemCount: countCartItems(response),
  itemGroups: response.basketUpdateResult.itemGroups ?? [],
  limitedItems: response.limitedItems,
  limitedPromotionIds: response.limitedPromotionIds,
  pricingNotifications: response.pricingNotifications,
  totals: response.basketUpdateResult.totals,
  unavailableData: response.unavailableData
})

export const normalizeCartMutationResponse = (
  response: CartUpdateResponse
): Result.Result<NormalizedCartMutationResult, CartMutationResponseNormalizationError> =>
  Result.mapError(
    parseUnknown(NormalizedCartMutationResultSchema, projectCartMutationResponse(response)),
    cartMutationResponseSchemaMismatch
  )

export const parseCartMutationResponse = (
  input: unknown
): Result.Result<NormalizedCartMutationResult, CartMutationResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(CartUpdateResponseSchema, input), cartMutationResponseSchemaMismatch),
    normalizeCartMutationResponse
  )

export const applyCartDeltas = (
  session: SessionSnapshot,
  deltas: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ApplyCartDeltasResult, ApplyCartDeltasError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeApplyQuantityRequest(deltas)), (request) =>
    Effect.flatMap(requestVoilaJson(CartUpdateResponseSchema, session, request, cookieJarPort), (result) =>
      Effect.map(Effect.fromResult(parseCartMutationResponse(result.value)), (value) => ({
        session: result.session,
        value
      }))
    )
  )

const makeCartDeltas = (
  items: ReadonlyArray<CartItemQuantityInput>,
  makeDelta: (productId: ProductUuid, quantity: number) => Result.Result<unknown, CartQuantityDeltaError>
): Result.Result<ReadonlyArray<unknown>, CartQuantityDeltaError> =>
  items.reduce<Result.Result<ReadonlyArray<unknown>, CartQuantityDeltaError>>(
    (deltas, item) =>
      Result.flatMap(deltas, (current) =>
        Result.map(makeDelta(item.productId, item.quantity), (delta) => [...current, delta])
      ),
    Result.succeed([])
  )

const applyCartItemOperation = (
  session: SessionSnapshot,
  items: unknown,
  makeDelta: (productId: ProductUuid, quantity: number) => Result.Result<unknown, CartQuantityDeltaError>,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ApplyCartDeltasResult, CartItemsOperationError, VoilaTransport> =>
  Effect.flatMap(
    Effect.fromResult(Result.mapError(parseUnknown(CartItemQuantityInputArraySchema, items), cartItemsInputInvalid)),
    (parsedItems) =>
      Effect.flatMap(Effect.fromResult(makeCartDeltas(parsedItems, makeDelta)), (deltas) =>
        applyCartDeltas(session, deltas, cookieJarPort)
      )
  )

export const addCartItems = (
  session: SessionSnapshot,
  items: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ApplyCartDeltasResult, CartItemsOperationError, VoilaTransport> =>
  applyCartItemOperation(session, items, makeAddToCartDelta, cookieJarPort)

export const removeCartItems = (
  session: SessionSnapshot,
  items: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ApplyCartDeltasResult, CartItemsOperationError, VoilaTransport> =>
  applyCartItemOperation(session, items, makeRemoveFromCartDelta, cookieJarPort)
