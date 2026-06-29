import { Either, Schema } from "effect"

import { type CartQuantityDeltaError, makeAddToCartDelta, makeRemoveFromCartDelta } from "../domain/cart.js"
import { parseUnknown } from "../domain/parse.js"
import {
  type CartItemQuantityInput,
  CartItemQuantityInputSchema,
  type CartUpdateResponse,
  CartUpdateResponseSchema,
  type NormalizedCartMutationResult,
  NormalizedCartMutationResultSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { CartQuantityRequestError } from "./urls.js"
import { makeApplyQuantityRequest } from "./urls.js"

export type CartMutationResponseNormalizationError = {
  readonly _tag: "CartMutationResponseSchemaMismatch"
  readonly message: string
}

export type ApplyCartDeltasError = CartQuantityRequestError | VoilaSdkError

export type ApplyCartDeltasResult = VoilaJsonResult<NormalizedCartMutationResult>

export type CartItemsInputError = {
  readonly _tag: "CartItemsInputInvalid"
  readonly message: string
}

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

export const normalizeCartMutationResponse = (
  response: CartUpdateResponse
): NormalizedCartMutationResult => ({
  itemCount: countCartItems(response),
  itemGroups: response.basketUpdateResult.itemGroups ?? [],
  limitedItems: response.limitedItems,
  limitedPromotionIds: response.limitedPromotionIds,
  pricingNotifications: response.pricingNotifications,
  totals: response.basketUpdateResult.totals,
  unavailableData: response.unavailableData
})

export const parseCartMutationResponse = (
  input: unknown
): Either.Either<NormalizedCartMutationResult, CartMutationResponseNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(CartUpdateResponseSchema, input), cartMutationResponseSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedCartMutationResultSchema, normalizeCartMutationResponse(response)),
        cartMutationResponseSchemaMismatch
      )
  )

export const applyCartDeltas = async (
  session: SessionSnapshot,
  deltas: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<ApplyCartDeltasResult, ApplyCartDeltasError>> => {
  const request = makeApplyQuantityRequest(deltas)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    CartUpdateResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeCartMutationResponse(result.value)
  }))
}

const makeCartDeltas = (
  items: ReadonlyArray<CartItemQuantityInput>,
  makeDelta: (productId: string, quantity: number) => Either.Either<unknown, CartQuantityDeltaError>
): Either.Either<ReadonlyArray<unknown>, CartQuantityDeltaError> =>
  items.reduce<Either.Either<ReadonlyArray<unknown>, CartQuantityDeltaError>>(
    (deltas, item) =>
      Either.flatMap(deltas, (current) =>
        Either.map(
          makeDelta(item.productId, item.quantity),
          (delta) => [...current, delta]
        )),
    Either.right([])
  )

const applyCartItemOperation = async (
  session: SessionSnapshot,
  items: unknown,
  transport: VoilaTransport,
  makeDelta: (productId: string, quantity: number) => Either.Either<unknown, CartQuantityDeltaError>,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<ApplyCartDeltasResult, CartItemsOperationError>> => {
  const parsedItems = Either.mapLeft(
    parseUnknown(CartItemQuantityInputArraySchema, items),
    cartItemsInputInvalid
  )

  if (Either.isLeft(parsedItems)) {
    return Either.left(parsedItems.left)
  }

  const deltas = makeCartDeltas(parsedItems.right, makeDelta)

  if (Either.isLeft(deltas)) {
    return Either.left(deltas.left)
  }

  return applyCartDeltas(session, deltas.right, transport, cookieJarPort)
}

export const addCartItems = async (
  session: SessionSnapshot,
  items: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<ApplyCartDeltasResult, CartItemsOperationError>> =>
  applyCartItemOperation(session, items, transport, makeAddToCartDelta, cookieJarPort)

export const removeCartItems = async (
  session: SessionSnapshot,
  items: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<ApplyCartDeltasResult, CartItemsOperationError>> =>
  applyCartItemOperation(session, items, transport, makeRemoveFromCartDelta, cookieJarPort)
