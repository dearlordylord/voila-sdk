import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type DeliveryDestination,
  DeliveryDestinationSchema,
  type DeliveryDestinationsDiagnostic,
  DeliveryDestinationsDiagnosticSchema,
  type NormalizedDeliveryDestinations,
  NormalizedDeliveryDestinationsSchema,
  type RawDeliveryDestination,
  RawDeliveryDestinationSchema,
  type RawDeliveryDestinationsResponse,
  RawDeliveryDestinationsResponseSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { DeliveryDestinationRequestError, DeliveryDestinationsRequestError } from "./urls.js"
import { makeDeliveryDestinationRequest, makeDeliveryDestinationsRequest } from "./urls.js"

export type DeliveryDestinationsResponseNormalizationError = {
  readonly _tag: "DeliveryDestinationsResponseSchemaMismatch"
  readonly message: string
}

export type GetDeliveryDestinationsError = DeliveryDestinationsRequestError | VoilaSdkError

export type GetDeliveryDestinationsResult = VoilaJsonResult<NormalizedDeliveryDestinations>

export type GetDeliveryDestinationError = DeliveryDestinationRequestError | VoilaSdkError

export type GetDeliveryDestinationResult = VoilaJsonResult<DeliveryDestination>

const deliverableValue = "DELIVERABLE"

const deliveryDestinationsResponseSchemaMismatch = (): DeliveryDestinationsResponseNormalizationError => ({
  _tag: "DeliveryDestinationsResponseSchemaMismatch",
  message: "Voila delivery destinations response does not match the SDK schema"
})

export const normalizeDeliveryDestination = (
  destination: RawDeliveryDestination
): DeliveryDestination => {
  const regionId = destination.resolvedRegionId ?? destination.regionId

  return {
    ...(destination.addressId === undefined ? {} : { addressId: destination.addressId }),
    ...(destination.deliverability === undefined ? {} : { deliverability: destination.deliverability }),
    deliverable: destination.deliverability === deliverableValue,
    deliveryDestinationId: destination.deliveryDestinationId,
    ...(destination.deliveryInstructions === undefined
      ? {}
      : { deliveryInstructions: destination.deliveryInstructions }),
    ...(destination.deliveryMethod === undefined ? {} : { deliveryMethod: destination.deliveryMethod }),
    ...(destination.formattedAddress === undefined ? {} : { formattedAddress: destination.formattedAddress }),
    ...(destination.name === undefined ? {} : { nickname: destination.name }),
    ...(regionId === undefined ? {} : { regionId })
  }
}

export const normalizeDeliveryDestinationsResponse = (
  response: RawDeliveryDestinationsResponse
): NormalizedDeliveryDestinations => ({
  destinations: response.map(normalizeDeliveryDestination)
})

export const parseDeliveryDestinationsResponse = (
  input: unknown
): Either.Either<NormalizedDeliveryDestinations, DeliveryDestinationsResponseNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(
      parseUnknown(RawDeliveryDestinationsResponseSchema, input),
      deliveryDestinationsResponseSchemaMismatch
    ),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedDeliveryDestinationsSchema, normalizeDeliveryDestinationsResponse(response)),
        deliveryDestinationsResponseSchemaMismatch
      )
  )

export const parseDeliveryDestinationResponse = (
  input: unknown
): Either.Either<DeliveryDestination, DeliveryDestinationsResponseNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(RawDeliveryDestinationSchema, input), deliveryDestinationsResponseSchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(DeliveryDestinationSchema, normalizeDeliveryDestination(response)),
        deliveryDestinationsResponseSchemaMismatch
      )
  )

const redactDestinationForDiagnostic = (
  destination: DeliveryDestination
): DeliveryDestinationsDiagnostic["destinations"][number] => ({
  ...(destination.addressId === undefined ? {} : { addressId: "[redacted]" }),
  ...(destination.deliverability === undefined ? {} : { deliverability: destination.deliverability }),
  deliverable: destination.deliverable,
  deliveryDestinationId: "[redacted]",
  ...(destination.deliveryInstructions === undefined ? {} : { deliveryInstructions: "[redacted]" }),
  ...(destination.deliveryMethod === undefined ? {} : { deliveryMethod: destination.deliveryMethod }),
  ...(destination.formattedAddress === undefined ? {} : { formattedAddress: "[redacted]" }),
  ...(destination.nickname === undefined ? {} : { nickname: "[redacted]" }),
  ...(destination.regionId === undefined ? {} : { regionId: "[redacted]" })
})

export const makeDeliveryDestinationsDiagnostic = (
  destinations: NormalizedDeliveryDestinations
): DeliveryDestinationsDiagnostic => ({
  count: destinations.destinations.length,
  destinations: destinations.destinations.map(redactDestinationForDiagnostic)
})

export const parseDeliveryDestinationsDiagnostic = (
  input: unknown
): Either.Either<DeliveryDestinationsDiagnostic, DeliveryDestinationsResponseNormalizationError> =>
  Either.mapLeft(
    parseUnknown(DeliveryDestinationsDiagnosticSchema, input),
    deliveryDestinationsResponseSchemaMismatch
  )

export const getDeliveryDestinations = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetDeliveryDestinationsResult, GetDeliveryDestinationsError>> => {
  const request = makeDeliveryDestinationsRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    RawDeliveryDestinationsResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeDeliveryDestinationsResponse(result.value)
  }))
}

export const getDeliveryDestination = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetDeliveryDestinationResult, GetDeliveryDestinationError>> => {
  const request = makeDeliveryDestinationRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    RawDeliveryDestinationSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeDeliveryDestination(result.value)
  }))
}
