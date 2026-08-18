import { Effect, Result } from "effect"

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
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
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

export const normalizeDeliveryDestination = (destination: RawDeliveryDestination): DeliveryDestination => {
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
): NormalizedDeliveryDestinations => ({ destinations: response.map(normalizeDeliveryDestination) })

export const parseDeliveryDestinationsResponse = (
  input: unknown
): Result.Result<NormalizedDeliveryDestinations, DeliveryDestinationsResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(
      parseUnknown(RawDeliveryDestinationsResponseSchema, input),
      deliveryDestinationsResponseSchemaMismatch
    ),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedDeliveryDestinationsSchema, normalizeDeliveryDestinationsResponse(response)),
        deliveryDestinationsResponseSchemaMismatch
      )
  )

export const parseDeliveryDestinationResponse = (
  input: unknown
): Result.Result<DeliveryDestination, DeliveryDestinationsResponseNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(RawDeliveryDestinationSchema, input), deliveryDestinationsResponseSchemaMismatch),
    (response) =>
      Result.mapError(
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
): Result.Result<DeliveryDestinationsDiagnostic, DeliveryDestinationsResponseNormalizationError> =>
  Result.mapError(parseUnknown(DeliveryDestinationsDiagnosticSchema, input), deliveryDestinationsResponseSchemaMismatch)

export const getDeliveryDestinations = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetDeliveryDestinationsResult, GetDeliveryDestinationsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeDeliveryDestinationsRequest(input)), (request) =>
    Effect.map(requestVoilaJson(RawDeliveryDestinationsResponseSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeDeliveryDestinationsResponse(result.value)
    }))
  )

export const getDeliveryDestination = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetDeliveryDestinationResult, GetDeliveryDestinationError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeDeliveryDestinationRequest(input)), (request) =>
    Effect.map(requestVoilaJson(RawDeliveryDestinationSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeDeliveryDestination(result.value)
    }))
  )
