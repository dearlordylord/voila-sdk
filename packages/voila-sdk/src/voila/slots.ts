import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type NormalizedSlot,
  type NormalizedSlotCarrier,
  type NormalizedSlotListing,
  NormalizedSlotListingSchema,
  type NormalizedSlotReservation,
  NormalizedSlotReservationSchema,
  type RawSlot,
  type RawSlotCarrier,
  type RawSlotListingResponse,
  RawSlotListingResponseSchema,
  type RawSlotReservationResponse,
  RawSlotReservationResponseSchema,
  type SessionSnapshot,
  type SlotReservationInput,
  type SlotReservationSelectionInput,
  SlotReservationSelectionInputSchema
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"
import type { SlotListingRequestError, SlotReservationRequestError } from "./slot-urls.js"
import { makeSlotListingRequest, makeSlotReservationRequest } from "./slot-urls.js"

export type SlotListingNormalizationError = { readonly _tag: "SlotListingSchemaMismatch"; readonly message: string }

export type SlotReservationNormalizationError = {
  readonly _tag: "SlotReservationSchemaMismatch"
  readonly message: string
}

export type SlotReservationSelectionError =
  | { readonly _tag: "SlotReservationSelectionInvalid"; readonly message: string }
  | { readonly _tag: "SlotReservationSlotIdMissing"; readonly message: string }
  | { readonly _tag: "SlotReservationSlotUnavailable"; readonly message: string }
  | { readonly _tag: "SlotReservationSlotExpired"; readonly message: string }
  | { readonly _tag: "SlotReservationSlotEndTimeInvalid"; readonly message: string }

export type GetSlotListingsError = SlotListingRequestError | VoilaSdkError

export type GetSlotListingsResult = VoilaJsonResult<NormalizedSlotListing>

export type ReserveSlotError = SlotReservationRequestError | VoilaSdkError

export type ReserveSlotResult = VoilaJsonResult<NormalizedSlotReservation>

const availableAttribute = "AVAILABLE"

const slotListingSchemaMismatch = (): SlotListingNormalizationError => ({
  _tag: "SlotListingSchemaMismatch",
  message: "Voila slot listing response does not match the SDK schema"
})

const slotReservationSchemaMismatch = (): SlotReservationNormalizationError => ({
  _tag: "SlotReservationSchemaMismatch",
  message: "Voila slot reservation response does not match the SDK schema"
})

const slotReservationSelectionInvalid = (): SlotReservationSelectionError => ({
  _tag: "SlotReservationSelectionInvalid",
  message: "Slot reservation selection input does not match the SDK schema"
})

const slotReservationSlotIdMissing = (): SlotReservationSelectionError => ({
  _tag: "SlotReservationSlotIdMissing",
  message: "Slot reservation requires a listed slot with a slot ID"
})

const slotReservationSlotUnavailable = (): SlotReservationSelectionError => ({
  _tag: "SlotReservationSlotUnavailable",
  message: "Slot reservation requires an available listed slot"
})

const slotReservationSlotExpired = (): SlotReservationSelectionError => ({
  _tag: "SlotReservationSlotExpired",
  message: "Slot reservation requires a listed slot that has not already ended"
})

const slotReservationSlotEndTimeInvalid = (): SlotReservationSelectionError => ({
  _tag: "SlotReservationSlotEndTimeInvalid",
  message: "Slot reservation slot end time is not a valid timestamp"
})

const normalizeSlot = (
  carrier: RawSlotCarrier,
  date: string,
  slotListingId: string | undefined,
  slot: RawSlot
): NormalizedSlot => ({
  attributes: slot.attributes ?? [],
  available: (slot.attributes ?? []).includes(availableAttribute),
  ...(carrier.carrierId === undefined ? {} : { carrierId: carrier.carrierId }),
  date,
  ...(slot.deliveryPrice === undefined ? {} : { deliveryPrice: slot.deliveryPrice }),
  ...(slot.slotWindow?.endTime === undefined ? {} : { endTime: slot.slotWindow.endTime }),
  ...(slot.onDemandProperties === undefined ? {} : { onDemandProperties: slot.onDemandProperties }),
  ...(slot.slotId === undefined ? {} : { slotId: slot.slotId }),
  ...(slotListingId === undefined ? {} : { slotListingId }),
  ...(slot.slotWindow?.startTime === undefined ? {} : { startTime: slot.slotWindow.startTime }),
  ...(slot.timeZoneId === undefined ? {} : { timeZoneId: slot.timeZoneId }),
  ...(slot.title === undefined ? {} : { title: slot.title }),
  ...(slot.type === undefined ? {} : { type: slot.type })
})

const dayListingId = (carrier: RawSlotCarrier, day: string): string | undefined =>
  (carrier.daysMapping ?? []).find((mapping) => mapping.day === day)?.slotListingId

const normalizeCarrierSlots = (carrier: RawSlotCarrier): ReadonlyArray<NormalizedSlot> =>
  (carrier.gridSlots ?? []).flatMap((gridDay) =>
    gridDay.slots.map((slot) => normalizeSlot(carrier, gridDay.day, dayListingId(carrier, gridDay.day), slot))
  )

const normalizeCarrier = (carrier: RawSlotCarrier): NormalizedSlotCarrier => ({
  ...(carrier.carrierId === undefined ? {} : { carrierId: carrier.carrierId }),
  ...(carrier.carrierName === undefined ? {} : { carrierName: carrier.carrierName }),
  days: carrier.daysMapping ?? [],
  ...(carrier.title === undefined ? {} : { title: carrier.title })
})

export const normalizeSlotListingResponse = (response: RawSlotListingResponse): NormalizedSlotListing => {
  const slots = response.carriers.flatMap(normalizeCarrierSlots)

  return {
    availableSlotCount: slots.filter((slot) => slot.available).length,
    carriers: response.carriers.map(normalizeCarrier),
    slots
  }
}

export const normalizeSlotReservationResponse = (response: RawSlotReservationResponse): NormalizedSlotReservation => ({
  ...(response.confirmationData === undefined ? {} : { confirmationData: response.confirmationData }),
  ...(response.slot.expiryTime === undefined ? {} : { expiryTime: response.slot.expiryTime }),
  ...(response.slot.minimumCheckoutThreshold === undefined
    ? {}
    : { minimumCheckoutThreshold: response.slot.minimumCheckoutThreshold }),
  ...(response.slot.originalMinimumCheckoutThreshold === undefined
    ? {}
    : { originalMinimumCheckoutThreshold: response.slot.originalMinimumCheckoutThreshold }),
  reserved: true,
  ...(response.slot.slotId === undefined ? {} : { slotId: response.slot.slotId }),
  ...(response.slot.timeZoneId === undefined ? {} : { timeZoneId: response.slot.timeZoneId })
})

const checkSlotEndTime = (
  input: SlotReservationSelectionInput,
  now: Date
): Result.Result<void, SlotReservationSelectionError> => {
  if (input.slot.endTime === undefined) {
    return Result.succeed(undefined)
  }

  const endTime = Date.parse(input.slot.endTime)

  if (Number.isNaN(endTime)) {
    return Result.fail(slotReservationSlotEndTimeInvalid())
  }

  return endTime <= now.getTime() ? Result.fail(slotReservationSlotExpired()) : Result.succeed(undefined)
}

export const makeSlotReservationInputFromSlot = (
  input: unknown,
  now: Date
): Result.Result<SlotReservationInput, SlotReservationSelectionError> => {
  const selection = Result.mapError(
    parseUnknown(SlotReservationSelectionInputSchema, input),
    slotReservationSelectionInvalid
  )

  if (Result.isFailure(selection)) {
    return Result.fail(selection.failure)
  }

  if (!selection.success.slot.available) {
    return Result.fail(slotReservationSlotUnavailable())
  }

  if (selection.success.slot.slotId === undefined) {
    return Result.fail(slotReservationSlotIdMissing())
  }

  const endTimeCheck = checkSlotEndTime(selection.success, now)

  if (Result.isFailure(endTimeCheck)) {
    return Result.fail(endTimeCheck.failure)
  }

  return Result.succeed({
    allowReservationOverwrite: true,
    confirmSlotReservation: true,
    deliveryDestinationId: selection.success.deliveryDestinationId,
    ...(selection.success.externalAddress === undefined ? {} : { externalAddress: selection.success.externalAddress }),
    regionId: selection.success.regionId,
    slotId: selection.success.slot.slotId
  })
}

export const parseSlotListingResponse = (
  input: unknown
): Result.Result<NormalizedSlotListing, SlotListingNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(RawSlotListingResponseSchema, input), slotListingSchemaMismatch),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedSlotListingSchema, normalizeSlotListingResponse(response)),
        slotListingSchemaMismatch
      )
  )

export const parseSlotReservationResponse = (
  input: unknown
): Result.Result<NormalizedSlotReservation, SlotReservationNormalizationError> =>
  Result.flatMap(
    Result.mapError(parseUnknown(RawSlotReservationResponseSchema, input), slotReservationSchemaMismatch),
    (response) =>
      Result.mapError(
        parseUnknown(NormalizedSlotReservationSchema, normalizeSlotReservationResponse(response)),
        slotReservationSchemaMismatch
      )
  )

export const getSlotListings = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetSlotListingsResult, GetSlotListingsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeSlotListingRequest(input)), (request) =>
    Effect.map(requestVoilaJson(RawSlotListingResponseSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeSlotListingResponse(result.value)
    }))
  )

export const reserveSlot = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ReserveSlotResult, ReserveSlotError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeSlotReservationRequest(input)), (request) =>
    Effect.map(requestVoilaJson(RawSlotReservationResponseSchema, session, request, cookieJarPort), (result) => ({
      session: result.session,
      value: normalizeSlotReservationResponse(result.value)
    }))
  )
