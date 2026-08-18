import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type ActiveShoppingContextResponse,
  ActiveShoppingContextResponseSchema,
  type CartImpactProduct,
  type CartImpactWarning,
  type CartProposition,
  type DeliveryContextChangeResult,
  DeliveryContextChangeResultSchema,
  type DeliveryContextPreviewResponse,
  DeliveryContextPreviewResponseSchema,
  type DeliveryPropositionDetailsResponse,
  DeliveryPropositionDetailsResponseSchema,
  type NormalizedActiveShoppingContext,
  NormalizedActiveShoppingContextSchema,
  type NormalizedDeliveryContextPreview,
  NormalizedDeliveryContextPreviewSchema,
  type NormalizedDeliveryPropositionDetails,
  NormalizedDeliveryPropositionDetailsSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaHttpRequest, VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type {
  ActiveShoppingContextRequestError,
  ApplyDeliveryContextChangeRequestError,
  DeliveryContextPreviewRequestError,
  DeliveryPropositionDetailsRequestError,
  SetActiveCartPropositionRequestError,
  SetActiveDeliveryDestinationRequestError
} from "./urls.js"
import {
  makeActiveShoppingContextRequest,
  makeDeliveryContextPreviewRequest,
  makeDeliveryPropositionDetailsRequest,
  makeSetActiveCartPropositionRequest,
  makeSetActiveDeliveryDestinationRequest,
  parseApplyDeliveryContextChangeInput
} from "./urls.js"

export type ShoppingContextNormalizationError = {
  readonly _tag: "ShoppingContextSchemaMismatch"
  readonly message: string
}

export type GetActiveShoppingContextError = ActiveShoppingContextRequestError | VoilaSdkError

export type GetActiveShoppingContextResult = VoilaJsonResult<NormalizedActiveShoppingContext>

export type GetDeliveryPropositionDetailsError = DeliveryPropositionDetailsRequestError | VoilaSdkError

export type GetDeliveryPropositionDetailsResult = VoilaJsonResult<NormalizedDeliveryPropositionDetails>

export type PreviewDeliveryContextChangeError = DeliveryContextPreviewRequestError | VoilaSdkError

export type PreviewDeliveryContextChangeResult = VoilaJsonResult<NormalizedDeliveryContextPreview>

export type SetActiveDeliveryDestinationContextError = SetActiveDeliveryDestinationRequestError | VoilaSdkError

export type SetActiveCartPropositionContextError = SetActiveCartPropositionRequestError | VoilaSdkError

export type SetActiveShoppingContextResult = VoilaJsonResult<NormalizedActiveShoppingContext>

export type ApplyDeliveryContextChangeError =
  | ApplyDeliveryContextChangeRequestError
  | DeliveryContextPreviewRequestError
  | SetActiveCartPropositionRequestError
  | SetActiveDeliveryDestinationRequestError
  | ShoppingContextNormalizationError
  | VoilaSdkError

export type ApplyDeliveryContextChangeResult = VoilaJsonResult<DeliveryContextChangeResult>

const emptyLength = 0

const shoppingContextSchemaMismatch = (): ShoppingContextNormalizationError => ({
  _tag: "ShoppingContextSchemaMismatch",
  message: "Voila shopping context response does not match the SDK schema"
})

export const normalizeActiveShoppingContext = (
  response: ActiveShoppingContextResponse
): NormalizedActiveShoppingContext => ({
  ...(response.cartPropositionId === undefined ? {} : { cartPropositionId: response.cartPropositionId }),
  ...(response.deliveryDestinationId === undefined ? {} : { deliveryDestinationId: response.deliveryDestinationId }),
  ...(response.deliveryMethod === undefined ? {} : { deliveryMethod: response.deliveryMethod }),
  ...(response.propositionType === undefined ? {} : { propositionType: response.propositionType }),
  ...(response.regionId === undefined ? {} : { regionId: response.regionId }),
  ...(response.type === undefined ? {} : { type: response.type })
})

export const normalizeDeliveryPropositionDetailsResponse = (
  response: DeliveryPropositionDetailsResponse
): NormalizedDeliveryPropositionDetails => ({
  propositions: "propositions" in response ? response.propositions : response
})

const getProductsFromCartProposition = (
  proposition: CartProposition | undefined,
  key: "limitedItems" | "products"
): ReadonlyArray<CartImpactProduct> => (proposition?.assignedCheckoutGroups ?? []).flatMap((group) => group[key] ?? [])

const makeCartImpactWarning = (
  kind: CartImpactWarning["kind"],
  products: ReadonlyArray<CartImpactProduct>
): CartImpactWarning | undefined => (products.length === emptyLength ? undefined : { kind, products })

const collectCartImpactWarnings = (response: DeliveryContextPreviewResponse): ReadonlyArray<CartImpactWarning> =>
  [
    makeCartImpactWarning(
      "origin-cart-items",
      getProductsFromCartProposition(response.originCartProposition, "products")
    ),
    makeCartImpactWarning(
      "destination-cart-items",
      getProductsFromCartProposition(response.destinationCartProposition, "products")
    ),
    makeCartImpactWarning(
      "limited-cart-items",
      getProductsFromCartProposition(response.destinationCartProposition, "limitedItems")
    )
  ].filter((warning): warning is CartImpactWarning => warning !== undefined)

export const normalizeDeliveryContextPreviewResponse = (
  response: DeliveryContextPreviewResponse
): NormalizedDeliveryContextPreview => {
  const cartImpactWarnings = collectCartImpactWarnings(response)

  return {
    cartImpactWarnings,
    ...(response.destinationCartProposition.cartPropositionId === undefined
      ? {}
      : { destinationCartPropositionId: response.destinationCartProposition.cartPropositionId }),
    ...(response.destinationCartProposition.regionId === undefined
      ? {}
      : { destinationRegionId: response.destinationCartProposition.regionId }),
    ...(response.originCartProposition?.cartPropositionId === undefined
      ? {}
      : { originCartPropositionId: response.originCartProposition.cartPropositionId }),
    ...(response.originCartProposition?.regionId === undefined
      ? {}
      : { originRegionId: response.originCartProposition.regionId }),
    requiresConfirmation: cartImpactWarnings.length > emptyLength
  }
}

export const parseActiveShoppingContextResponse = (
  input: unknown
): Result.Result<NormalizedActiveShoppingContext, ShoppingContextNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(ActiveShoppingContextResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedActiveShoppingContextSchema, normalizeActiveShoppingContext(response)),
        shoppingContextSchemaMismatch
      )
  )

export const parseDeliveryPropositionDetailsResponse = (
  input: unknown
): Result.Result<NormalizedDeliveryPropositionDetails, ShoppingContextNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(DeliveryPropositionDetailsResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedDeliveryPropositionDetailsSchema, normalizeDeliveryPropositionDetailsResponse(response)),
        shoppingContextSchemaMismatch
      )
  )

export const parseDeliveryContextPreviewResponse = (
  input: unknown
): Result.Result<NormalizedDeliveryContextPreview, ShoppingContextNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(DeliveryContextPreviewResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedDeliveryContextPreviewSchema, normalizeDeliveryContextPreviewResponse(response)),
        shoppingContextSchemaMismatch
      )
  )

export const getActiveShoppingContext = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetActiveShoppingContextResult, GetActiveShoppingContextError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeActiveShoppingContextRequest(input)), (request) =>
    requestNormalizedActiveShoppingContext(session, request, cookieJarPort)
  )

const requestNormalizedActiveShoppingContext = (
  session: SessionSnapshot,
  request: VoilaHttpRequest,
  cookieJarPort?: CookieJarPort
): Effect.Effect<SetActiveShoppingContextResult, VoilaSdkError, VoilaTransport> =>
  Effect.map(requestVoilaJson(ActiveShoppingContextResponseSchema, session, request, cookieJarPort), (result) => ({
    session: result.session,
    value: normalizeActiveShoppingContext(result.value)
  }))

export const getDeliveryPropositionDetails = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetDeliveryPropositionDetailsResult, GetDeliveryPropositionDetailsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeDeliveryPropositionDetailsRequest(input)), (request) =>
    Effect.map(
      requestVoilaJson(DeliveryPropositionDetailsResponseSchema, session, request, cookieJarPort),
      (result) => ({ session: result.session, value: normalizeDeliveryPropositionDetailsResponse(result.value) })
    )
  )

export const previewDeliveryContextChange = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<PreviewDeliveryContextChangeResult, PreviewDeliveryContextChangeError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeDeliveryContextPreviewRequest(input)), (request) =>
    Effect.map(requestVoilaJson(DeliveryContextPreviewResponseSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeDeliveryContextPreviewResponse(result.value)
    }))
  )

export const setActiveDeliveryDestinationContext = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<SetActiveShoppingContextResult, SetActiveDeliveryDestinationContextError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeSetActiveDeliveryDestinationRequest(input)), (request) =>
    requestNormalizedActiveShoppingContext(session, request, cookieJarPort)
  )

export const setActiveCartPropositionContext = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<SetActiveShoppingContextResult, SetActiveCartPropositionContextError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeSetActiveCartPropositionRequest(input)), (request) =>
    requestNormalizedActiveShoppingContext(session, request, cookieJarPort)
  )

const makeRequiresConfirmationResult = (
  session: SessionSnapshot,
  preview: NormalizedDeliveryContextPreview
): Result.Result<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError> =>
  Result.map(
    Result.mapError(
      parseUnknown(DeliveryContextChangeResultSchema, { applied: false, preview, status: "requires-confirmation" }),
      shoppingContextSchemaMismatch
    ),
    (value) => ({ session, value })
  )

const makeAppliedResult = (
  session: SessionSnapshot,
  preview: NormalizedDeliveryContextPreview,
  context: NormalizedActiveShoppingContext
): Result.Result<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError> =>
  Result.map(
    Result.mapError(
      parseUnknown(DeliveryContextChangeResultSchema, { applied: true, context, preview, status: "applied" }),
      shoppingContextSchemaMismatch
    ),
    (value) => ({ session, value })
  )

/**
 * Applying a context change is two requests with a decision between them: the
 * preview says what the change would cost the cart, and only an explicit
 * `allowCartImpact` lets the second request run. The proposition path is taken
 * when the preview names both propositions — that is Voila's own signal that
 * the destination lives under a different proposition than the origin.
 */
export const applyDeliveryContextChange = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(parseApplyDeliveryContextChangeInput(input)), (parsedInput) =>
    Effect.flatMap(
      previewDeliveryContextChange(
        session,
        {
          deliveryDestinationId: parsedInput.deliveryDestinationId,
          destinationRegionId: parsedInput.destinationRegionId
        },
        cookieJarPort
      ),
      (preview) => {
        if (preview.value.requiresConfirmation && !parsedInput.allowCartImpact) {
          return Effect.fromResult(makeRequiresConfirmationResult(preview.session, preview.value))
        }

        const accountContext = {
          ...(parsedInput.customerId === undefined ? {} : { customerId: parsedInput.customerId }),
          ...(parsedInput.visitorId === undefined ? {} : { visitorId: parsedInput.visitorId })
        }
        const applied: Effect.Effect<SetActiveShoppingContextResult, ApplyDeliveryContextChangeError, VoilaTransport> =
          preview.value.destinationCartPropositionId !== undefined &&
          preview.value.originCartPropositionId !== undefined
            ? setActiveCartPropositionContext(
                preview.session,
                {
                  ...accountContext,
                  destinationCartPropositionId: preview.value.destinationCartPropositionId,
                  originCartPropositionId: preview.value.originCartPropositionId
                },
                cookieJarPort
              )
            : setActiveDeliveryDestinationContext(
                preview.session,
                {
                  ...accountContext,
                  deliveryDestinationId: parsedInput.deliveryDestinationId,
                  regionId: parsedInput.destinationRegionId
                },
                cookieJarPort
              )

        return Effect.flatMap(applied, (context) =>
          Effect.fromResult(makeAppliedResult(context.session, preview.value, context.value))
        )
      }
    )
  )
