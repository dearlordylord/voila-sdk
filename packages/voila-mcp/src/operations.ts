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
import type { Layer } from "effect"
import { Effect, Either, Schema } from "effect"

import {
  authGuidanceForHealth,
  authGuidanceForSnapshot,
  type OperationAuthGuidance,
  OperationAuthGuidanceSchema
} from "./auth-guidance.js"
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

/**
 * Every tool result crosses a protocol boundary, so the shapes are schema-owned
 * rather than hand-written: the MCP toolkit encodes them, and a field that
 * exists only in TypeScript would leave the wire contract unstated.
 */
export const OperationFailureSchema = Schema.Struct({
  _tag: Schema.String,
  authGuidance: Schema.optionalWith(OperationAuthGuidanceSchema, { exact: true }),
  message: Schema.String,
  status: Schema.optionalWith(Schema.Number, { exact: true })
})

export type OperationFailure = Schema.Schema.Type<typeof OperationFailureSchema>

export const OperationExecutionSuccessSchema = Schema.Struct({
  authGuidance: Schema.optionalWith(OperationAuthGuidanceSchema, { exact: true }),
  ok: Schema.Literal(true),
  value: Schema.Unknown
})

export type OperationExecutionSuccess = Schema.Schema.Type<typeof OperationExecutionSuccessSchema>

export const OperationExecutionFailureSchema = Schema.Struct({
  error: OperationFailureSchema,
  ok: Schema.Literal(false)
})

export type OperationExecutionFailure = Schema.Schema.Type<typeof OperationExecutionFailureSchema>

/**
 * The two halves an operation can land on, unioned. The halves are separate
 * types because an Effect-shaped operation puts them on separate channels — and
 * they are unioned here because a caller at the process edge (the CLI) reports
 * both the same way.
 */
export type OperationExecutionResult = OperationExecutionFailure | OperationExecutionSuccess

/**
 * What one operation produced against the session it ran with: the tool result,
 * and the snapshot the live response refreshed — absent when nothing about the
 * session moved and the file must stay as it is.
 */
export interface SessionOperationOutcome<A> {
  readonly refreshed?: SdkSessionSnapshot
  readonly value: A
}

export type SessionOperation<A> = (
  current: SdkSessionSnapshot
) => Effect.Effect<SessionOperationOutcome<A>, OperationFailure, VoilaTransport>

/**
 * The session an operation runs with is never handed out to be persisted later.
 * `withSession` runs the operation inside the port's own read-modify-write
 * cycle: the operation sees the session as it exists right now, and the refresh
 * it reports is a transform over that same value, so a re-login landing while
 * the request is in flight cannot be overwritten by the session this operation
 * started from.
 */
export interface OperationSessionPort {
  readonly withSession: <A>(operation: SessionOperation<A>) => Effect.Effect<A, OperationFailure, VoilaTransport>
}

/**
 * What an operation needs from the process it runs in. The transport arrives as
 * a layer rather than a service value: the SDK asks for it from the
 * environment, and the process that owns a network stack is the one that says
 * what that stack is.
 */
export interface OperationEnvironment {
  readonly authGuidance?: OperationAuthGuidance
  readonly session: OperationSessionPort
  readonly transport: Layer.Layer<VoilaTransport>
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

const success = (value: unknown, authGuidance?: OperationAuthGuidance): OperationExecutionSuccess => ({
  ...(authGuidance === undefined ? {} : { authGuidance }),
  ok: true,
  value
})

const failure = (error: OperationFailure, authGuidance?: OperationAuthGuidance): OperationExecutionFailure => ({
  error: { ...error, ...(authGuidance === undefined ? {} : { authGuidance }) },
  ok: false
})

const isTaggedError = (value: unknown): value is OperationFailure =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof value._tag === "string" &&
  "message" in value &&
  typeof value.message === "string"

const redactError = (error: unknown): OperationFailure => {
  if (!isTaggedError(error)) {
    return { _tag: "VoilaOperationFailed", message: "Voila operation failed" }
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
): Effect.Effect<A, OperationExecutionFailure> =>
  Effect.mapError(parseUnknown(schema, input), () => failure(inputInvalid()))

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

export const makeGuestSessionSnapshot = (): Effect.Effect<SdkSessionSnapshot, OperationFailure, VoilaTransport> =>
  Effect.flatMap(
    Effect.mapError(bootstrapGuestSession(), (error) => bootstrapFailed(redactError(error))),
    (bootstrapped) => Either.mapLeft(makeGuestSdkSessionSnapshot(bootstrapped.session), sessionUpdateInvalid)
  )

/**
 * One operation run against the session port: the ok half stays on the success
 * channel, the not-ok half moves to the error channel. The session cycle itself
 * failing is folded into the same failure shape, with the environment's auth
 * guidance attached — a caller that cannot get a session at all needs the same
 * "how do I log in" answer as one whose session was rejected.
 */
const runSessionResult = (
  env: OperationEnvironment,
  operation: SessionOperation<OperationExecutionResult>
): Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure, VoilaTransport> =>
  Effect.matchEffect(env.session.withSession(operation), {
    onFailure: (error) => Effect.fail(failure(error, env.authGuidance)),
    onSuccess: (executed) => (executed.ok ? Effect.succeed(executed) : Effect.fail(executed))
  })

const refreshedOutcome = (
  env: OperationEnvironment,
  current: SdkSessionSnapshot,
  result: VoilaJsonResult<unknown>
): SessionOperationOutcome<OperationExecutionResult> => {
  const refreshed = updateSdkSession(current, result.session)

  return Either.isLeft(refreshed)
    ? { value: failure(refreshed.left) }
    : { refreshed: refreshed.right, value: success(result.value, authGuidanceForSnapshot(env.authGuidance, current)) }
}

/**
 * What every request-shaped operation looks like from here: a session and a
 * parsed input in, a refreshed session and a value out. Operations that fail
 * do so on the Effect error channel with their own tags, which `redactError`
 * strips down to what a tool result may carry.
 */
type SessionOperationExecutor<A> = (
  session: SessionSnapshot,
  input: A
) => Effect.Effect<VoilaJsonResult<unknown>, unknown, VoilaTransport>

const runSessionOperation = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  env: OperationEnvironment,
  execute: SessionOperationExecutor<A>,
  authGuidanceOnFailure = false
): Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure, VoilaTransport> =>
  Effect.flatMap(parseInput(schema, input), (parsed) =>
    runSessionResult(env, (current) =>
      Effect.match(execute(current.session, parsed), {
        onFailure: (error) => ({
          value: failure(redactError(error), authGuidanceOnFailure ? env.authGuidance : undefined)
        }),
        onSuccess: (result) => refreshedOutcome(env, current, result)
      })
    )
  )

const runHealth = (
  input: unknown,
  env: OperationEnvironment
): Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure, VoilaTransport> =>
  Effect.flatMap(parseInput(EmptyOperationInputSchema, input), () =>
    runSessionResult(env, (current) =>
      Effect.match(checkSessionHealth(current), {
        onFailure: (error) => ({ value: failure(redactError(error)) }),
        onSuccess: (health) => ({
          refreshed: health.session,
          value: success(
            {
              diagnostic: redactSdkSessionSnapshot(health.session),
              ...(health.status === "retry" ? { reason: health.reason } : {}),
              status: health.status
            },
            authGuidanceForHealth(env.authGuidance, health)
          )
        })
      })
    )
  )

type OperationRun = Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure, VoilaTransport>

const runSearch = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(ProductListOperationInputSchema, input, env, (session, parsed) =>
    searchProducts(session, makeSdkSearchInput(parsed))
  )

const runCategoryProducts = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(CategoryProductsOperationInputSchema, input, env, (session, parsed) =>
    getCategoryProducts(session, makeSdkCategoryInput(parsed))
  )

const runDiscountedProducts = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(DiscountedProductsOperationInputSchema, input, env, (session, parsed) =>
    getDiscountedProducts(session, makeSdkDiscountInput(parsed))
  )

const runActiveShoppingContext = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(ActiveShoppingContextOperationInputSchema, input, env, (session, parsed) =>
    getActiveShoppingContext(session, makeSdkActiveShoppingContextInput(parsed))
  )

const runSlotListings = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(SlotListingsOperationInputSchema, input, env, (session, parsed) =>
    getSlotListings(session, makeSdkSlotListingsInput(parsed))
  )

const runReserveSlot = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(SlotReservationOperationInputSchema, input, env, (session, parsed) =>
    reserveSlot(session, makeSdkSlotReservationInput(parsed))
  )

const runGetCart = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(EmptyOperationInputSchema, input, env, (session) => getCart(session))

const runCompletedOrders = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(
    OrderListOperationInputSchema,
    input,
    env,
    (session, parsed) => getCompletedOrders(session, makeSdkOrderListInput(parsed)),
    true
  )

const runOrderDetails = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(
    OrderDetailsOperationInputSchema,
    input,
    env,
    (session, parsed) => getOrderDetails(session, makeSdkOrderDetailsInput(parsed)),
    true
  )

const runCompletedOrderItems = (input: unknown, env: OperationEnvironment): OperationRun =>
  runSessionOperation(
    OrderItemsOperationInputSchema,
    input,
    env,
    (session, parsed) => getCompletedOrderItems(session, makeSdkOrderItemsInput(parsed)),
    true
  )

const runCartItems = (input: unknown, env: OperationEnvironment, apply: typeof addCartItems): OperationRun =>
  runSessionOperation(CartItemOperationInputSchema, input, env, (session, parsed) => apply(session, parsed.items))

const runOperation = (name: VoilaOperationName, input: unknown, env: OperationEnvironment): OperationRun => {
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

const operationDefect = (): OperationExecutionFailure =>
  failure({ _tag: "VoilaOperationFailed", message: "Voila operation failed" })

/**
 * The registry's one entry point. The transport layer is provided here rather
 * than by callers: every consumer — MCP toolkit handler, CLI command — wants
 * the operation run against the environment it was handed, and none of them
 * should have to know what a transport is.
 *
 * Defects are folded into the failure channel here because this is the last
 * place that knows the difference between a Voila error and a rendered
 * exception: a defect escaping this boundary reaches a client as a protocol
 * error carrying whatever the thrower put in it, and this layer is the one
 * handling cookies and tokens.
 */
export const runVoilaOperation = (
  name: VoilaOperationName,
  input: unknown,
  env: OperationEnvironment
): Effect.Effect<OperationExecutionSuccess, OperationExecutionFailure> =>
  Effect.catchAllDefect(Effect.provide(runOperation(name, input, env), env.transport), () =>
    Effect.fail(operationDefect())
  )

export const normalizeCliCartInput = (productId: string, quantity: number): CartItemOperationInput => ({
  items: [{ productId, quantity }]
})
