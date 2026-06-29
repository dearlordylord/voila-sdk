import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import { type SlotListingInput, SlotListingInputSchema, SlotReservationInputSchema } from "../domain/schemas/index.js"
import { VOILA_BASE_URL } from "./urls.js"

const SLOT_LISTING_PATH = "/api/ecomslots/v2/slots"
const SLOT_RESERVATION_PATH = "/api/ecomslots/v1/slots/reservation"

export interface SlotListingRequest {
  readonly body: string
  readonly method: "POST"
  readonly url: URL
}

export interface SlotReservationRequest {
  readonly body: string
  readonly method: "POST"
  readonly url: URL
}

export type SlotListingRequestError = {
  readonly _tag: "SlotListingInputInvalid"
  readonly message: string
}

export type SlotReservationRequestError = {
  readonly _tag: "SlotReservationInputInvalid"
  readonly message: string
}

const slotListingInputInvalid = (): SlotListingRequestError => ({
  _tag: "SlotListingInputInvalid",
  message: "Slot listing request input does not match the SDK schema"
})

const slotReservationInputInvalid = (): SlotReservationRequestError => ({
  _tag: "SlotReservationInputInvalid",
  message: "Slot reservation request input does not match the SDK schema"
})

const makeSlotAnalyticsData = (
  input: SlotListingInput
): Readonly<Record<string, string>> | undefined => {
  if (input.sessionId === undefined) {
    return undefined
  }

  return {
    ...(input.pageViewId === undefined ? {} : { pageViewId: input.pageViewId }),
    platform: "WEB",
    sessionId: input.sessionId,
    ...(input.viewingLocation === undefined ? {} : { viewingLocation: input.viewingLocation })
  }
}

export const makeSlotListingRequest = (
  input: unknown
): Either.Either<SlotListingRequest, SlotListingRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(SlotListingInputSchema, input), slotListingInputInvalid),
    (slotInput) => {
      const analyticsData = makeSlotAnalyticsData(slotInput)

      return {
        body: JSON.stringify({
          deliveryDestinationId: slotInput.deliveryDestinationId,
          displayConfiguration: slotInput.displayConfiguration,
          ...(analyticsData === undefined ? {} : { analyticsData }),
          ...(slotInput.numberOfDays === undefined ? {} : { numberOfDays: slotInput.numberOfDays }),
          regionId: slotInput.regionId,
          shippingGroupType: slotInput.shippingGroupType
        }),
        method: "POST",
        url: new URL(SLOT_LISTING_PATH, VOILA_BASE_URL)
      }
    }
  )

export const makeSlotReservationRequest = (
  input: unknown
): Either.Either<SlotReservationRequest, SlotReservationRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(SlotReservationInputSchema, input), slotReservationInputInvalid),
    (slotInput) => ({
      body: JSON.stringify({
        deliveryDestinationId: slotInput.deliveryDestinationId,
        ...(slotInput.externalAddress === undefined ? {} : { externalAddress: slotInput.externalAddress }),
        regionId: slotInput.regionId,
        slotId: slotInput.slotId
      }),
      method: "POST",
      url: new URL(SLOT_RESERVATION_PATH, VOILA_BASE_URL)
    })
  )
