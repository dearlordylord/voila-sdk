import { Either } from "effect"

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
import type { VoilaHttpRequest, VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
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

export type SetActiveDeliveryDestinationContextError =
  | SetActiveDeliveryDestinationRequestError
  | VoilaSdkError

export type SetActiveCartPropositionContextError =
  | SetActiveCartPropositionRequestError
  | VoilaSdkError

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
): CartImpactWarning | undefined =>
  products.length === emptyLength
    ? undefined
    : {
      kind,
      products
    }

const collectCartImpactWarnings = (
  response: DeliveryContextPreviewResponse
): ReadonlyArray<CartImpactWarning> =>
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
): Either.Either<NormalizedActiveShoppingContext, ShoppingContextNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(ActiveShoppingContextResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedActiveShoppingContextSchema, normalizeActiveShoppingContext(response)),
        shoppingContextSchemaMismatch
      )
  )

export const parseDeliveryPropositionDetailsResponse = (
  input: unknown
): Either.Either<NormalizedDeliveryPropositionDetails, ShoppingContextNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(DeliveryPropositionDetailsResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(
          NormalizedDeliveryPropositionDetailsSchema,
          normalizeDeliveryPropositionDetailsResponse(response)
        ),
        shoppingContextSchemaMismatch
      )
  )

export const parseDeliveryContextPreviewResponse = (
  input: unknown
): Either.Either<NormalizedDeliveryContextPreview, ShoppingContextNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(DeliveryContextPreviewResponseSchema, input), shoppingContextSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedDeliveryContextPreviewSchema, normalizeDeliveryContextPreviewResponse(response)),
        shoppingContextSchemaMismatch
      )
  )

export const getActiveShoppingContext = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetActiveShoppingContextResult, GetActiveShoppingContextError>> => {
  const request = makeActiveShoppingContextRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  return requestNormalizedActiveShoppingContext(session, request.right, transport, cookieJarPort)
}

const requestNormalizedActiveShoppingContext = async (
  session: SessionSnapshot,
  request: VoilaHttpRequest,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<SetActiveShoppingContextResult, VoilaSdkError>> =>
  Either.map(
    await requestVoilaJson(
      ActiveShoppingContextResponseSchema,
      session,
      request,
      transport,
      cookieJarPort
    ),
    (result) => ({
      session: result.session,
      value: normalizeActiveShoppingContext(result.value)
    })
  )

export const getDeliveryPropositionDetails = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetDeliveryPropositionDetailsResult, GetDeliveryPropositionDetailsError>> => {
  const request = makeDeliveryPropositionDetailsRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    DeliveryPropositionDetailsResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeDeliveryPropositionDetailsResponse(result.value)
  }))
}

export const previewDeliveryContextChange = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<PreviewDeliveryContextChangeResult, PreviewDeliveryContextChangeError>> => {
  const request = makeDeliveryContextPreviewRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    DeliveryContextPreviewResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeDeliveryContextPreviewResponse(result.value)
  }))
}

export const setActiveDeliveryDestinationContext = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<SetActiveShoppingContextResult, SetActiveDeliveryDestinationContextError>> => {
  const request = makeSetActiveDeliveryDestinationRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  return requestNormalizedActiveShoppingContext(session, request.right, transport, cookieJarPort)
}

export const setActiveCartPropositionContext = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<SetActiveShoppingContextResult, SetActiveCartPropositionContextError>> => {
  const request = makeSetActiveCartPropositionRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  return requestNormalizedActiveShoppingContext(session, request.right, transport, cookieJarPort)
}

const makeRequiresConfirmationResult = (
  session: SessionSnapshot,
  preview: NormalizedDeliveryContextPreview
): Either.Either<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError> =>
  Either.map(
    Either.mapLeft(
      parseUnknown(DeliveryContextChangeResultSchema, {
        applied: false,
        preview,
        status: "requires-confirmation"
      }),
      shoppingContextSchemaMismatch
    ),
    (value) => ({
      session,
      value
    })
  )

const makeAppliedResult = (
  session: SessionSnapshot,
  preview: NormalizedDeliveryContextPreview,
  context: NormalizedActiveShoppingContext
): Either.Either<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError> =>
  Either.map(
    Either.mapLeft(
      parseUnknown(DeliveryContextChangeResultSchema, {
        applied: true,
        context,
        preview,
        status: "applied"
      }),
      shoppingContextSchemaMismatch
    ),
    (value) => ({
      session,
      value
    })
  )

export const applyDeliveryContextChange = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<ApplyDeliveryContextChangeResult, ApplyDeliveryContextChangeError>> => {
  const parsedInput = parseApplyDeliveryContextChangeInput(input)

  if (Either.isLeft(parsedInput)) {
    return Either.left(parsedInput.left)
  }

  const preview = await previewDeliveryContextChange(
    session,
    {
      deliveryDestinationId: parsedInput.right.deliveryDestinationId,
      destinationRegionId: parsedInput.right.destinationRegionId
    },
    transport,
    cookieJarPort
  )

  if (Either.isLeft(preview)) {
    return Either.left(preview.left)
  }

  if (preview.right.value.requiresConfirmation && !parsedInput.right.allowCartImpact) {
    return makeRequiresConfirmationResult(preview.right.session, preview.right.value)
  }

  const accountContext = {
    ...(parsedInput.right.customerId === undefined ? {} : { customerId: parsedInput.right.customerId }),
    ...(parsedInput.right.visitorId === undefined ? {} : { visitorId: parsedInput.right.visitorId })
  }

  if (
    preview.right.value.destinationCartPropositionId !== undefined
    && preview.right.value.originCartPropositionId !== undefined
  ) {
    const context = await setActiveCartPropositionContext(
      preview.right.session,
      {
        ...accountContext,
        destinationCartPropositionId: preview.right.value.destinationCartPropositionId,
        originCartPropositionId: preview.right.value.originCartPropositionId
      },
      transport,
      cookieJarPort
    )

    return Either.isLeft(context)
      ? Either.left(context.left)
      : makeAppliedResult(context.right.session, preview.right.value, context.right.value)
  }

  const context = await setActiveDeliveryDestinationContext(
    preview.right.session,
    {
      ...accountContext,
      deliveryDestinationId: parsedInput.right.deliveryDestinationId,
      regionId: parsedInput.right.destinationRegionId
    },
    transport,
    cookieJarPort
  )

  return Either.isLeft(context)
    ? Either.left(context.left)
    : makeAppliedResult(context.right.session, preview.right.value, context.right.value)
}
