import {
  addCartItems,
  bootstrapGuestSession,
  checkSessionHealth,
  getCart,
  getCategoryProducts,
  getCompletedOrders,
  makeAuthenticatedSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  parseUnknown,
  redactSdkSessionSnapshot,
  removeCartItems,
  type SdkSessionSnapshot,
  searchProducts,
  type SessionSnapshot,
  type VoilaTransport
} from "@firfi/voila-sdk"
import type { Schema } from "effect"
import { Either } from "effect"

import { authGuidanceForHealth, authGuidanceForSnapshot, type OperationAuthGuidance } from "./auth-guidance.js"
import {
  type CartItemOperationInput,
  CartItemOperationInputSchema,
  type CategoryProductsOperationInput,
  CategoryProductsOperationInputSchema,
  EmptyOperationInputSchema,
  type OrderListOperationInput,
  OrderListOperationInputSchema,
  type ProductListOperationInput,
  ProductListOperationInputSchema
} from "./operation-schemas.js"

export const mcpName = "io.github.dearlordylord/voila-mcp"

export type VoilaOperationName =
  | "voila_add_cart_items"
  | "voila_check_session_health"
  | "voila_get_cart"
  | "voila_get_category_products"
  | "voila_get_completed_orders"
  | "voila_remove_cart_items"
  | "voila_search_products"

export interface VoilaOperationDescriptor {
  readonly description: string
  readonly name: VoilaOperationName
  readonly title: string
}

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

export const voilaOperationDescriptors: ReadonlyArray<VoilaOperationDescriptor> = [
  {
    description: "Check whether the configured Voila session is active, retryable, expired, or guest-only.",
    name: "voila_check_session_health",
    title: "Check Session Health"
  },
  {
    description: "Search Voila products by text query for the current session context.",
    name: "voila_search_products",
    title: "Search Products"
  },
  {
    description: "Fetch products for a Voila category id for the current session context.",
    name: "voila_get_category_products",
    title: "Get Category Products"
  },
  {
    description: "Fetch completed Voila orders with cursor pagination for the authenticated account.",
    name: "voila_get_completed_orders",
    title: "Get Completed Orders"
  },
  {
    description: "Fetch the current active cart with totals, limited items, unavailable data, and pricing notices.",
    name: "voila_get_cart",
    title: "Get Cart"
  },
  {
    description: "Add product quantity deltas to the active cart using Voila product UUIDs.",
    name: "voila_add_cart_items",
    title: "Add Cart Items"
  },
  {
    description: "Remove product quantity deltas from the active cart using Voila product UUIDs.",
    name: "voila_remove_cart_items",
    title: "Remove Cart Items"
  }
]

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
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(ProductListOperationInputSchema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const result = await searchProducts(
    snapshot.right.session,
    makeSdkSearchInput(parsed.right),
    env.transport
  )

  if (Either.isLeft(result)) {
    return failure(redactError(result.left))
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

const runCategoryProducts = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(CategoryProductsOperationInputSchema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const result = await getCategoryProducts(
    snapshot.right.session,
    makeSdkCategoryInput(parsed.right),
    env.transport
  )

  if (Either.isLeft(result)) {
    return failure(redactError(result.left))
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

const runGetCart = async (
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

  const result = await getCart(snapshot.right.session, env.transport)

  if (Either.isLeft(result)) {
    return failure(redactError(result.left))
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

const runCompletedOrders = async (
  input: unknown,
  env: OperationEnvironment
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(OrderListOperationInputSchema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const result = await getCompletedOrders(
    snapshot.right.session,
    makeSdkOrderListInput(parsed.right),
    env.transport
  )

  if (Either.isLeft(result)) {
    return failure(redactError(result.left), env.authGuidance)
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

const runCartItems = async (
  input: unknown,
  env: OperationEnvironment,
  apply: typeof addCartItems
): Promise<OperationExecutionResult> => {
  const parsed = parseInput(CartItemOperationInputSchema, input)

  if (Either.isLeft(parsed)) {
    return failure(parsed.left)
  }

  const snapshot = await loadSession(env)

  if (Either.isLeft(snapshot)) {
    return failure(snapshot.left, env.authGuidance)
  }

  const result = await apply(snapshot.right.session, parsed.right.items, env.transport)

  if (Either.isLeft(result)) {
    return failure(redactError(result.left))
  }

  const persisted = await persistResultSession(env, snapshot.right, result.right.session)

  return persisted ?? success(result.right.value, authGuidanceForSnapshot(env.authGuidance, snapshot.right))
}

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
    case "voila_get_completed_orders":
      return runCompletedOrders(input, env)
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
