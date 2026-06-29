import {
  addCartItems,
  bootstrapGuestSession,
  checkSessionHealth,
  getCart,
  getCategoryProducts,
  getCompletedOrderItems,
  getCompletedOrders,
  getOrderDetails,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  parseUnknown,
  redactSdkSessionSnapshot,
  removeCartItems,
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
  type CartItemOperationInput,
  CartItemOperationInputSchema,
  type CategoryProductsOperationInput,
  CategoryProductsOperationInputSchema,
  EmptyOperationInputSchema,
  type OrderDetailsOperationInput,
  OrderDetailsOperationInputSchema,
  type OrderItemsOperationInput,
  OrderItemsOperationInputSchema,
  type OrderListOperationInput,
  OrderListOperationInputSchema,
  type ProductListOperationInput,
  ProductListOperationInputSchema
} from "./operation-schemas.js"

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

const defaultPageSize = 12

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

const makeSdkSearchInput = (input: ProductListOperationInput) => ({
  pageSize: input.pageSize ?? defaultPageSize,
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
  query: input.query
})

const makeSdkCategoryInput = (input: CategoryProductsOperationInput) => ({
  categoryId: input.categoryId,
  pageSize: input.pageSize ?? defaultPageSize,
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken })
})

const makeSdkOrderListInput = (input: OrderListOperationInput) => ({
  ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken })
})

const makeSdkOrderDetailsInput = (input: OrderDetailsOperationInput) => ({
  orderId: input.orderId
})

const makeSdkOrderItemsInput = (input: OrderItemsOperationInput) => ({
  ...(input.fromDate === undefined ? {} : { fromDate: input.fromDate }),
  ...(input.maxOrders === undefined ? {} : { maxOrders: input.maxOrders }),
  ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
  ...(input.toDate === undefined ? {} : { toDate: input.toDate })
})

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
    case "voila_get_cart":
      return runGetCart(input, env)
    case "voila_get_category_products":
      return runCategoryProducts(input, env)
    case "voila_get_completed_order_items":
      return runCompletedOrderItems(input, env)
    case "voila_get_completed_orders":
      return runCompletedOrders(input, env)
    case "voila_get_order_details":
      return runOrderDetails(input, env)
    case "voila_remove_cart_items":
      return runCartItems(input, env, removeCartItems)
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
