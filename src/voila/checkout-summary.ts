import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type CheckoutChargeComponent,
  type CheckoutCharges,
  type CheckoutSlotSummary,
  type CheckoutSummarySignal,
  type CheckoutSummaryWarning,
  type NormalizedCheckoutFees,
  type NormalizedCheckoutSummary,
  NormalizedCheckoutSummarySchema,
  type RawCheckoutDelivery,
  type RawCheckoutSummaryResponse,
  RawCheckoutSummaryResponseSchema,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { Money } from "../domain/schemas/money.js"
import type { CheckoutSummaryRequestError } from "./checkout-urls.js"
import { makeCheckoutSummaryRequest } from "./checkout-urls.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CookieJarPort } from "./session-snapshot.js"

export type CheckoutSummaryNormalizationError = {
  readonly _tag: "CheckoutSummarySchemaMismatch"
  readonly message: string
}

export type GetCheckoutSummaryError = CheckoutSummaryRequestError | VoilaSdkError

export type GetCheckoutSummaryResult = VoilaJsonResult<NormalizedCheckoutSummary>

const checkoutSummarySchemaMismatch = (): CheckoutSummaryNormalizationError => ({
  _tag: "CheckoutSummarySchemaMismatch",
  message: "Voila checkout summary response does not match the SDK schema"
})

const chargeAmount = (charge: CheckoutChargeComponent | undefined): Money | undefined =>
  charge?.finalPrice ?? charge?.price

const normalizeFees = (charges: CheckoutCharges | undefined): NormalizedCheckoutFees => {
  const carrierBag = chargeAmount(charges?.carrierBag)
  const delivery = chargeAmount(charges?.delivery)
  const invoice = chargeAmount(charges?.invoice)
  const preparation = chargeAmount(charges?.preparation)
  const smallOrder = chargeAmount(charges?.smallOrder)

  return {
    ...(carrierBag === undefined ? {} : { carrierBag }),
    ...(delivery === undefined ? {} : { delivery }),
    ...(invoice === undefined ? {} : { invoice }),
    ...(preparation === undefined ? {} : { preparation }),
    ...(smallOrder === undefined ? {} : { smallOrder })
  }
}

const normalizeSelectedSlot = (delivery: RawCheckoutDelivery | undefined): CheckoutSlotSummary | undefined =>
  delivery === undefined
    ? undefined
    : {
      ...(delivery.deliveryPriceChanged === undefined ? {} : { deliveryPriceChanged: delivery.deliveryPriceChanged }),
      ...(delivery.endTime === undefined ? {} : { endTime: delivery.endTime }),
      ...(delivery.expiryTime === undefined ? {} : { expiryTime: delivery.expiryTime }),
      ...(delivery.price === undefined ? {} : { price: delivery.price }),
      ...(delivery.slotId === undefined ? {} : { slotId: delivery.slotId }),
      ...(delivery.startTime === undefined ? {} : { startTime: delivery.startTime }),
      ...(delivery.timeZoneId === undefined ? {} : { timeZoneId: delivery.timeZoneId })
    }

const tagWarnings = (
  kind: CheckoutSummaryWarning["kind"],
  signals: ReadonlyArray<CheckoutSummarySignal>
): ReadonlyArray<CheckoutSummaryWarning> =>
  signals.map((signal) => ({
    kind,
    signal
  }))

export const normalizeCheckoutSummaryResponse = (
  response: RawCheckoutSummaryResponse
): NormalizedCheckoutSummary => {
  const checkoutRestrictions = response.checkout.checkoutRestrictions ?? []
  const limitedItems = response.limitedItems ?? []
  const pricingNotifications = response.pricingNotifications ?? []
  const selectedSlot = normalizeSelectedSlot(response.checkout.delivery)
  const substitutions = response.substitutions ?? []
  const unavailableData = response.unavailableData ?? []

  return {
    basketAboveThreshold: response.checkout.basketAboveThreshold ?? false,
    ...(response.cartId === undefined ? {} : { basketId: response.cartId }),
    canCheckout: response.checkout.canCheckout ?? false,
    ...(response.checkoutCorrelationId === undefined
      ? {}
      : { checkoutCorrelationId: response.checkoutCorrelationId }),
    checkoutRestrictions,
    fees: normalizeFees(response.charges),
    limitedItems,
    ...(response.checkout.minimumCheckoutThreshold === undefined
      ? {}
      : { minimumCheckoutThreshold: response.checkout.minimumCheckoutThreshold }),
    ...(response.orderId === undefined ? {} : { orderId: response.orderId }),
    pricingNotifications,
    ...(selectedSlot === undefined ? {} : { selectedSlot }),
    ...(response.checkout.shippingGroupType === undefined
      ? {}
      : { shippingGroupType: response.checkout.shippingGroupType }),
    ...(response.checkout.shippingGroupTypeDisplayName === undefined
      ? {}
      : { shippingGroupTypeDisplayName: response.checkout.shippingGroupTypeDisplayName }),
    substitutions,
    ...(response.totals === undefined ? {} : { totals: response.totals }),
    unavailableData,
    warnings: [
      ...tagWarnings("checkout-restriction", checkoutRestrictions),
      ...tagWarnings("limited-item", limitedItems),
      ...tagWarnings("pricing-notification", pricingNotifications),
      ...tagWarnings("substitution", substitutions),
      ...tagWarnings("unavailable-item", unavailableData)
    ]
  }
}

export const parseCheckoutSummaryResponse = (
  input: unknown
): Either.Either<NormalizedCheckoutSummary, CheckoutSummaryNormalizationError> =>
  Either.flatMap(
    Either.mapLeft(parseUnknown(RawCheckoutSummaryResponseSchema, input), checkoutSummarySchemaMismatch),
    (response) =>
      Either.mapLeft(
        parseUnknown(NormalizedCheckoutSummarySchema, normalizeCheckoutSummaryResponse(response)),
        checkoutSummarySchemaMismatch
      )
  )

export const getCheckoutSummary = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetCheckoutSummaryResult, GetCheckoutSummaryError>> => {
  const request = makeCheckoutSummaryRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    RawCheckoutSummaryResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeCheckoutSummaryResponse(result.value)
  }))
}
