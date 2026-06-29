import {
  addCartItems,
  bootstrapGuestSession,
  checkSessionHealth,
  getActiveShoppingContext,
  getCart,
  getCategoryProducts,
  getCompletedOrderItems,
  getCompletedOrders,
  getDiscountedProducts,
  getOrderDetails,
  getSlotListings,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  parseUnknown,
  redactSdkSessionSnapshot,
  removeCartItems,
  reserveSlot,
  type SdkSessionSnapshot,
  searchProducts,
  type SessionSnapshot,
  type VoilaJsonResult,
  type VoilaTransport
} from "@firfi/voila-sdk"
import type { Schema } from "effect"
import { Either } from "effect"

import { authGuidanceForHealth, authGuidanceForSnapshot, type OperationAuthGuidance } from "./auth-guidance.js"
import { type VoilaOperationName } from "./operation-descriptors.js"
import {
  ActiveShoppingContextOperationInputSchema,
  type CartItemOperationInput,
  CartItemOperationInputSchema,
  CategoryProductsOperationInputSchema,
  DiscountedProductsOperationInputSchema,
  EmptyOperationInputSchema,
  OrderDetailsOperationInputSchema,
  OrderItemsOperationInputSchema,
  OrderListOperationInputSchema,
  ProductListOperationInputSchema,
  SlotListingsOperationInputSchema,
  SlotReservationOperationInputSchema
} from "./operation-schemas.js"
import {
  makeSdkActiveShoppingContextInput,
  makeSdkCategoryInput,
  makeSdkDiscountInput,
  makeSdkOrderDetailsInput,
  makeSdkOrderItemsInput,
  makeSdkOrderListInput,
  makeSdkSearchInput,
  makeSdkSlotListingsInput,
  makeSdkSlotReservationInput
} from "./sdk-operation-inputs.js"

export {
  mcpName,
  type VoilaOperationDescriptor,
  voilaOperationDescriptors,
  type VoilaOperationName
} from "./operation-descriptors.js"

export interface OperationFailure {
  readonly _tag: string
  readonly authGuidance?: OperationAuthGuidance
  readonly message: string
  readonly status?: number
}

export type OperationExecutionResult =
  | {
    readonly authGuidance?: OperationAuthGuidance
    readonly ok: true
    readonly value: unknown
  }
  | {
    readonly error: OperationFailure
    readonly ok: false
  }

export interface OperationSessionPort {
  readonly load: () => Promise<Either.Either<SdkSessionSnapshot, OperationFailure>>
  readonly save: (snapshot: SdkSessionSnapshot) => Promise<Either.Either<undefined, OperationFailure>>
}

export interface OperationEnvironment {
  readonly authGuidance?: OperationAuthGuidance
  readonly session: OperationSessionPort
  readonly transport: VoilaTransport
}

const inputInvalid = (): OperationFailure => ({
  _tag: "VoilaOperationInputInvalid",
  message: "Tool input does not match the operation schema"
})

const sessionUpdateInvalid = (): OperationFailure => ({
  _tag: "VoilaOperationSessionUpdateInvalid",
  message: "Updated session snapshot could not be encoded"
})

const bootstrapFailed = (failure: OperationFailure): OperationFailure => ({
  _tag: failure._tag,
  message: failure.message
})

const success = (value: unknown, authGuidance?: OperationAuthGuidance): OperationExecutionResult => ({
  ...(authGuidance === undefined ? {} : { authGuidance }),
  ok: true,
  value
})

const failure = (error: OperationFailure, authGuidance?: OperationAuthGuidance): OperationExecutionResult => ({
  error: {
    ...error,
    ...(authGuidance === undefined ? {} : { authGuidance })
  },
  ok: false
})

const isTaggedError = (value: unknown): value is OperationFailure =>
  typeof value === "object"
  && value !== null
  && "_tag" in value
  && typeof value._tag === "string"
  && "message" in value
  && typeof value.message === "string"

const redactError = (error: unknown): OperationFailure => {
  if (!isTaggedError(error)) {
    return {
      _tag: "VoilaOperationFailed",
      message: "Voila operation failed"
    }
  }

  return {
    _tag: error._tag,
    message: error.message,
    ...("status" in error && typeof error.status === "number" ? { status: error.status } : {})
  }
}

const parseInput = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown
): Either.Either<A, OperationFailure> => Either.mapLeft(parseUnknown(schema, input), inputInvalid)

const updateSdkSession = (
  previous: SdkSessionSnapshot,
  session: SessionSnapshot
): Either.Either<SdkSessionSnapshot, OperationFailure> =>
  previous.kind === "guest"
    ? Either.mapLeft(makeGuestSdkSessionSnapshot(session), sessionUpdateInvalid)
    : Either.mapLeft(
      makeAuthenticatedSdkSessionSnapshot(session, previous.state, previous.account),
      sessionUpdateInvalid
    )

const saveUpdatedSession = async (
  env: OperationEnvironment,
  previous: SdkSessionSnapshot,
  session: SessionSnapshot
): Promise<Either.Either<SdkSessionSnapshot, OperationFailure>> => {
  const updated = updateSdkSession(previous, session)

  if (Either.isLeft(updated)) {
    return Either.left(updated.left)
  }

  const saved = await env.session.save(updated.right)

  if (Either.isLeft(saved)) {
    return Either.left(saved.left)
  }

  return Either.right(updated.right)
}

export const makeGuestSessionSnapshot = async (
  transport: VoilaTransport
): Promise<Either.Either<SdkSessionSnapshot, OperationFailure>> => {
  const bootstrapped = await bootstrapGuestSession(transport)

  if (Either.isLeft(bootstrapped)) {
    return Either.left(bootstrapFailed(redactError(bootstrapped.left)))
  }

  return Either.mapLeft(makeGuestSdkSessionSnapshot(bootstrapped.right.session), sessionUpdateInvalid)
}

const loadSession = async (
  env: OperationEnvironment
): Promise<Either.Either<SdkSessionSnapshot, OperationFailure>> => env.session.load()

const persistResultSession = async (
  env: OperationEnvironment,
  previous: SdkSessionSnapshot,
  session: SessionSnapshot
): Promise<OperationExecutionResult | undefined> => {
  const saved = await saveUpdatedSession(env, previous, session)

  return Either.isLeft(saved) ? failure(saved.left) : undefined
}

type SessionOperationExecutor<A> = (
  session: SessionSnapshot,
  input: A
) => Promise<Either.Either<VoilaJsonResult<unknown>, unknown>>

const runSessionOperation = async <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  env: OperationEnvironment,
  execute: SessionOperationExecutor<A>,
  authGuidanceOnFailure = false
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(schema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const result = await execute(snapshot.right.session, parsed.right)

  if (Either.isLeft(result)) {
    return failure(redactError(result.left), authGuidanceOnFailure ? env.authGuidance : undefined)
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

const runHealth = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(EmptyOperationInputSchema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const health = await checkSessionHealth(snapshot.right, env.transport)

  if (Either.isLeft(health)) {
    return failure(redactError(health.left))
  }

  const saved = await env.session.save(health.right.session)

  if (Either.isLeft(saved)) {
    return failure(saved.left)
  }

  return success({
    diagnostic: redactSdkSessionSnapshot(health.right.session),
    ...(health.right.status === "retry" ? { reason: health.right.reason } : {}),
    status: health.right.status
  }, authGuidanceForHealth(env.authGuidance, health.right))
}

const runSearch = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    ProductListOperationInputSchema,
    input,
    env,
    (session, parsed) => searchProducts(session, makeSdkSearchInput(parsed), env.transport)
  )

const runCategoryProducts = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    CategoryProductsOperationInputSchema,
    input,
    env,
    (session, parsed) => getCategoryProducts(session, makeSdkCategoryInput(parsed), env.transport)
  )

const runDiscountedProducts = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    DiscountedProductsOperationInputSchema,
    input,
    env,
    (session, parsed) => getDiscountedProducts(session, makeSdkDiscountInput(parsed), env.transport)
  )

const runActiveShoppingContext = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    ActiveShoppingContextOperationInputSchema,
    input,
    env,
    (session, parsed) => getActiveShoppingContext(session, makeSdkActiveShoppingContextInput(parsed), env.transport)
  )

const runSlotListings = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    SlotListingsOperationInputSchema,
    input,
    env,
    (session, parsed) => getSlotListings(session, makeSdkSlotListingsInput(parsed), env.transport)
  )

const runReserveSlot = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    SlotReservationOperationInputSchema,
    input,
    env,
    (session, parsed) => reserveSlot(session, makeSdkSlotReservationInput(parsed), env.transport)
  )

const runGetCart = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    EmptyOperationInputSchema,
    input,
    env,
    (session) => getCart(session, env.transport)
  )

const runCompletedOrders = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    OrderListOperationInputSchema,
    input,
    env,
    (session, parsed) => getCompletedOrders(session, makeSdkOrderListInput(parsed), env.transport),
    true
  )

const runOrderDetails = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    OrderDetailsOperationInputSchema,
    input,
    env,
    (session, parsed) => getOrderDetails(session, makeSdkOrderDetailsInput(parsed), env.transport),
    true
  )

const runCompletedOrderItems = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    OrderItemsOperationInputSchema,
    input,
    env,
    (session, parsed) => getCompletedOrderItems(session, makeSdkOrderItemsInput(parsed), env.transport),
    true
  )

const runCartItems = async (
  input: unknown,
  env: OperationEnvironment,
  apply: typeof addCartItems
): Promise<OperationExecutionResult> =>
  runSessionOperation(
    CartItemOperationInputSchema,
    input,
    env,
    (session, parsed) => apply(session, parsed.items, env.transport)
  )

export const runVoilaOperation = async (
  name: VoilaOperationName,
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> => {
  switch (name) {
    case "voila_add_cart_items":
      return runCartItems(input, env, addCartItems)
    case "voila_check_session_health":
      return runHealth(input, env)
    case "voila_get_active_shopping_context":
      return runActiveShoppingContext(input, env)
    case "voila_get_cart":
      return runGetCart(input, env)
    case "voila_get_category_products":
      return runCategoryProducts(input, env)
    case "voila_get_discounted_products":
      return runDiscountedProducts(input, env)
    case "voila_get_completed_order_items":
      return runCompletedOrderItems(input, env)
    case "voila_get_completed_orders":
      return runCompletedOrders(input, env)
    case "voila_get_order_details":
      return runOrderDetails(input, env)
    case "voila_get_slot_listings":
      return runSlotListings(input, env)
    case "voila_remove_cart_items":
      return runCartItems(input, env, removeCartItems)
    case "voila_reserve_slot":
      return runReserveSlot(input, env)
    case "voila_search_products":
      return runSearch(input, env)
  }
}

export const normalizeCliCartInput = (productId: string, quantity: number): CartItemOperationInput => ({
  items: [{
    productId,
    quantity
  }]
})
