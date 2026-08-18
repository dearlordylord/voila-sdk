import { Schema } from "effect"

import { CartViewSignalSchema } from "./cart.js"
import { MoneySchema } from "./money.js"

import { withUnknownStringFields } from "./unknown-fields.js"

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isTrimmed()), Schema.check(Schema.isMinLength(1)))

export const CheckoutSummaryInputSchema = Schema.Struct({
  appliedPaymentCheckId: Schema.optionalKey(NonEmptyStringSchema),
  fetchAllocatedPaymentChecks: Schema.optionalKey(Schema.Boolean)
})

export type CheckoutSummaryInput = Schema.Schema.Type<typeof CheckoutSummaryInputSchema>

export const CheckoutSummarySignalSchema = CartViewSignalSchema

export type CheckoutSummarySignal = Schema.Schema.Type<typeof CheckoutSummarySignalSchema>

export const CheckoutSummaryTotalsSchema = Schema.revealCodec(
  Schema.Struct({
    depositsPrice: Schema.optionalKey(MoneySchema),
    environmentalHandlingPrice: Schema.optionalKey(MoneySchema),
    finalPrice: Schema.optionalKey(MoneySchema),
    itemPriceAfterPromos: Schema.optionalKey(MoneySchema),
    itemsRetailPrice: Schema.optionalKey(MoneySchema),
    retailPrice: Schema.optionalKey(MoneySchema),
    savingsPrice: Schema.optionalKey(MoneySchema),
    totalPrice: Schema.optionalKey(MoneySchema)
  }).pipe(withUnknownStringFields)
)

export type CheckoutSummaryTotals = Schema.Schema.Type<typeof CheckoutSummaryTotalsSchema>

export const CheckoutChargeComponentSchema = Schema.revealCodec(
  Schema.Struct({ finalPrice: Schema.optionalKey(MoneySchema), price: Schema.optionalKey(MoneySchema) }).pipe(
    withUnknownStringFields
  )
)

export type CheckoutChargeComponent = Schema.Schema.Type<typeof CheckoutChargeComponentSchema>

export const CheckoutChargesSchema = Schema.revealCodec(
  Schema.Struct({
    carrierBag: Schema.optionalKey(CheckoutChargeComponentSchema),
    delivery: Schema.optionalKey(CheckoutChargeComponentSchema),
    invoice: Schema.optionalKey(CheckoutChargeComponentSchema),
    preparation: Schema.optionalKey(CheckoutChargeComponentSchema),
    smallOrder: Schema.optionalKey(CheckoutChargeComponentSchema)
  }).pipe(withUnknownStringFields)
)

export type CheckoutCharges = Schema.Schema.Type<typeof CheckoutChargesSchema>

export const NormalizedCheckoutFeesSchema = Schema.Struct({
  carrierBag: Schema.optionalKey(MoneySchema),
  delivery: Schema.optionalKey(MoneySchema),
  invoice: Schema.optionalKey(MoneySchema),
  preparation: Schema.optionalKey(MoneySchema),
  smallOrder: Schema.optionalKey(MoneySchema)
})

export type NormalizedCheckoutFees = Schema.Schema.Type<typeof NormalizedCheckoutFeesSchema>

const CheckoutSlotShapeSchema = Schema.Struct({
  deliveryPriceChanged: Schema.optionalKey(Schema.Boolean),
  endTime: Schema.optionalKey(Schema.String),
  expiryTime: Schema.optionalKey(Schema.String),
  price: Schema.optionalKey(MoneySchema),
  slotId: Schema.optionalKey(Schema.String),
  startTime: Schema.optionalKey(Schema.String),
  timeZoneId: Schema.optionalKey(Schema.String)
})

export const RawCheckoutDeliverySchema = Schema.revealCodec(CheckoutSlotShapeSchema.pipe(withUnknownStringFields))

export type RawCheckoutDelivery = Schema.Schema.Type<typeof RawCheckoutDeliverySchema>

export const CheckoutSlotSummarySchema = CheckoutSlotShapeSchema

export type CheckoutSlotSummary = Schema.Schema.Type<typeof CheckoutSlotSummarySchema>

export const RawCheckoutStateSchema = Schema.revealCodec(
  Schema.Struct({
    basketAboveThreshold: Schema.optionalKey(Schema.Boolean),
    canCheckout: Schema.optionalKey(Schema.Boolean),
    checkoutRestrictions: Schema.optionalKey(Schema.Array(CheckoutSummarySignalSchema)),
    delivery: Schema.optionalKey(RawCheckoutDeliverySchema),
    minimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
    shippingGroupType: Schema.optionalKey(Schema.String),
    shippingGroupTypeDisplayName: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawCheckoutState = Schema.Schema.Type<typeof RawCheckoutStateSchema>

export const CheckoutSummaryWarningSchema = Schema.Struct({
  kind: Schema.Literals([
    "checkout-restriction",
    "limited-item",
    "pricing-notification",
    "substitution",
    "unavailable-item"
  ]),
  signal: CheckoutSummarySignalSchema
})

export type CheckoutSummaryWarning = Schema.Schema.Type<typeof CheckoutSummaryWarningSchema>

export const RawCheckoutSummaryResponseSchema = Schema.revealCodec(
  Schema.Struct({
    cartId: Schema.optionalKey(Schema.String),
    charges: Schema.optionalKey(CheckoutChargesSchema),
    checkout: RawCheckoutStateSchema,
    checkoutCorrelationId: Schema.optionalKey(Schema.String),
    limitedItems: Schema.optionalKey(Schema.Array(CheckoutSummarySignalSchema)),
    orderId: Schema.optionalKey(Schema.String),
    pricingNotifications: Schema.optionalKey(Schema.Array(CheckoutSummarySignalSchema)),
    substitutions: Schema.optionalKey(Schema.Array(CheckoutSummarySignalSchema)),
    totals: Schema.optionalKey(CheckoutSummaryTotalsSchema),
    unavailableData: Schema.optionalKey(Schema.Array(CheckoutSummarySignalSchema))
  }).pipe(withUnknownStringFields)
)

export type RawCheckoutSummaryResponse = Schema.Schema.Type<typeof RawCheckoutSummaryResponseSchema>

export const NormalizedCheckoutSummarySchema = Schema.Struct({
  basketAboveThreshold: Schema.Boolean,
  basketId: Schema.optionalKey(Schema.String),
  canCheckout: Schema.Boolean,
  checkoutCorrelationId: Schema.optionalKey(Schema.String),
  checkoutRestrictions: Schema.Array(CheckoutSummarySignalSchema),
  fees: NormalizedCheckoutFeesSchema,
  limitedItems: Schema.Array(CheckoutSummarySignalSchema),
  minimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
  orderId: Schema.optionalKey(Schema.String),
  pricingNotifications: Schema.Array(CheckoutSummarySignalSchema),
  selectedSlot: Schema.optionalKey(CheckoutSlotSummarySchema),
  shippingGroupType: Schema.optionalKey(Schema.String),
  shippingGroupTypeDisplayName: Schema.optionalKey(Schema.String),
  substitutions: Schema.Array(CheckoutSummarySignalSchema),
  totals: Schema.optionalKey(CheckoutSummaryTotalsSchema),
  unavailableData: Schema.Array(CheckoutSummarySignalSchema),
  warnings: Schema.Array(CheckoutSummaryWarningSchema)
})

export type NormalizedCheckoutSummary = Schema.Schema.Type<typeof NormalizedCheckoutSummarySchema>

export const CheckoutReadinessStatusSchema = Schema.Literals(["blocked", "needs-review", "ready-for-manual-checkout"])

export type CheckoutReadinessStatus = Schema.Schema.Type<typeof CheckoutReadinessStatusSchema>

export const CheckoutReadinessReasonSchema = Schema.Literals([
  "checkout-blocked",
  "review-signals-present",
  "ready-for-manual-checkout"
])

export type CheckoutReadinessReason = Schema.Schema.Type<typeof CheckoutReadinessReasonSchema>

export const CheckoutReadinessDecisionSchema = Schema.Struct({
  canContinueToManualCheckout: Schema.Boolean,
  checkoutRestrictions: Schema.Array(CheckoutSummarySignalSchema),
  reason: CheckoutReadinessReasonSchema,
  status: CheckoutReadinessStatusSchema,
  warnings: Schema.Array(CheckoutSummaryWarningSchema)
})

export type CheckoutReadinessDecision = Schema.Schema.Type<typeof CheckoutReadinessDecisionSchema>
