import { Schema } from "effect"

import { CartViewSignalSchema } from "./cart.js"
import { MoneySchema } from "./money.js"

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const NonEmptyStringSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))

export const CheckoutSummaryInputSchema = Schema.Struct({
  appliedPaymentCheckId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  fetchAllocatedPaymentChecks: Schema.optionalWith(Schema.Boolean, { exact: true })
})

export type CheckoutSummaryInput = Schema.Schema.Type<typeof CheckoutSummaryInputSchema>

export const CheckoutSummarySignalSchema = CartViewSignalSchema

export type CheckoutSummarySignal = Schema.Schema.Type<typeof CheckoutSummarySignalSchema>

export const CheckoutSummaryTotalsSchema = Schema.asSchema(
  Schema.Struct({
    depositsPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    environmentalHandlingPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    finalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    itemPriceAfterPromos: Schema.optionalWith(MoneySchema, { exact: true }),
    itemsRetailPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    retailPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    savingsPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    totalPrice: Schema.optionalWith(MoneySchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CheckoutSummaryTotals = Schema.Schema.Type<typeof CheckoutSummaryTotalsSchema>

export const CheckoutChargeComponentSchema = Schema.asSchema(
  Schema.Struct({
    finalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    price: Schema.optionalWith(MoneySchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CheckoutChargeComponent = Schema.Schema.Type<typeof CheckoutChargeComponentSchema>

export const CheckoutChargesSchema = Schema.asSchema(
  Schema.Struct({
    carrierBag: Schema.optionalWith(CheckoutChargeComponentSchema, { exact: true }),
    delivery: Schema.optionalWith(CheckoutChargeComponentSchema, { exact: true }),
    invoice: Schema.optionalWith(CheckoutChargeComponentSchema, { exact: true }),
    preparation: Schema.optionalWith(CheckoutChargeComponentSchema, { exact: true }),
    smallOrder: Schema.optionalWith(CheckoutChargeComponentSchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CheckoutCharges = Schema.Schema.Type<typeof CheckoutChargesSchema>

export const NormalizedCheckoutFeesSchema = Schema.Struct({
  carrierBag: Schema.optionalWith(MoneySchema, { exact: true }),
  delivery: Schema.optionalWith(MoneySchema, { exact: true }),
  invoice: Schema.optionalWith(MoneySchema, { exact: true }),
  preparation: Schema.optionalWith(MoneySchema, { exact: true }),
  smallOrder: Schema.optionalWith(MoneySchema, { exact: true })
})

export type NormalizedCheckoutFees = Schema.Schema.Type<typeof NormalizedCheckoutFeesSchema>

const CheckoutSlotShapeSchema = Schema.Struct({
  deliveryPriceChanged: Schema.optionalWith(Schema.Boolean, { exact: true }),
  endTime: Schema.optionalWith(Schema.String, { exact: true }),
  expiryTime: Schema.optionalWith(Schema.String, { exact: true }),
  price: Schema.optionalWith(MoneySchema, { exact: true }),
  slotId: Schema.optionalWith(Schema.String, { exact: true }),
  startTime: Schema.optionalWith(Schema.String, { exact: true }),
  timeZoneId: Schema.optionalWith(Schema.String, { exact: true })
})

export const RawCheckoutDeliverySchema = Schema.asSchema(
  CheckoutSlotShapeSchema.pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawCheckoutDelivery = Schema.Schema.Type<typeof RawCheckoutDeliverySchema>

export const CheckoutSlotSummarySchema = CheckoutSlotShapeSchema

export type CheckoutSlotSummary = Schema.Schema.Type<typeof CheckoutSlotSummarySchema>

export const RawCheckoutStateSchema = Schema.asSchema(
  Schema.Struct({
    basketAboveThreshold: Schema.optionalWith(Schema.Boolean, { exact: true }),
    canCheckout: Schema.optionalWith(Schema.Boolean, { exact: true }),
    checkoutRestrictions: Schema.optionalWith(Schema.Array(CheckoutSummarySignalSchema), { exact: true }),
    delivery: Schema.optionalWith(RawCheckoutDeliverySchema, { exact: true }),
    minimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
    shippingGroupType: Schema.optionalWith(Schema.String, { exact: true }),
    shippingGroupTypeDisplayName: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawCheckoutState = Schema.Schema.Type<typeof RawCheckoutStateSchema>

export const CheckoutSummaryWarningSchema = Schema.Struct({
  kind: Schema.Literal(
    "checkout-restriction",
    "limited-item",
    "pricing-notification",
    "substitution",
    "unavailable-item"
  ),
  signal: CheckoutSummarySignalSchema
})

export type CheckoutSummaryWarning = Schema.Schema.Type<typeof CheckoutSummaryWarningSchema>

export const RawCheckoutSummaryResponseSchema = Schema.asSchema(
  Schema.Struct({
    cartId: Schema.optionalWith(Schema.String, { exact: true }),
    charges: Schema.optionalWith(CheckoutChargesSchema, { exact: true }),
    checkout: RawCheckoutStateSchema,
    checkoutCorrelationId: Schema.optionalWith(Schema.String, { exact: true }),
    limitedItems: Schema.optionalWith(Schema.Array(CheckoutSummarySignalSchema), { exact: true }),
    orderId: Schema.optionalWith(Schema.String, { exact: true }),
    pricingNotifications: Schema.optionalWith(Schema.Array(CheckoutSummarySignalSchema), { exact: true }),
    substitutions: Schema.optionalWith(Schema.Array(CheckoutSummarySignalSchema), { exact: true }),
    totals: Schema.optionalWith(CheckoutSummaryTotalsSchema, { exact: true }),
    unavailableData: Schema.optionalWith(Schema.Array(CheckoutSummarySignalSchema), { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawCheckoutSummaryResponse = Schema.Schema.Type<typeof RawCheckoutSummaryResponseSchema>

export const NormalizedCheckoutSummarySchema = Schema.Struct({
  basketAboveThreshold: Schema.Boolean,
  basketId: Schema.optionalWith(Schema.String, { exact: true }),
  canCheckout: Schema.Boolean,
  checkoutCorrelationId: Schema.optionalWith(Schema.String, { exact: true }),
  checkoutRestrictions: Schema.Array(CheckoutSummarySignalSchema),
  fees: NormalizedCheckoutFeesSchema,
  limitedItems: Schema.Array(CheckoutSummarySignalSchema),
  minimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
  orderId: Schema.optionalWith(Schema.String, { exact: true }),
  pricingNotifications: Schema.Array(CheckoutSummarySignalSchema),
  selectedSlot: Schema.optionalWith(CheckoutSlotSummarySchema, { exact: true }),
  shippingGroupType: Schema.optionalWith(Schema.String, { exact: true }),
  shippingGroupTypeDisplayName: Schema.optionalWith(Schema.String, { exact: true }),
  substitutions: Schema.Array(CheckoutSummarySignalSchema),
  totals: Schema.optionalWith(CheckoutSummaryTotalsSchema, { exact: true }),
  unavailableData: Schema.Array(CheckoutSummarySignalSchema),
  warnings: Schema.Array(CheckoutSummaryWarningSchema)
})

export type NormalizedCheckoutSummary = Schema.Schema.Type<typeof NormalizedCheckoutSummarySchema>

export const CheckoutReadinessStatusSchema = Schema.Literal(
  "blocked",
  "needs-review",
  "ready-for-manual-checkout"
)

export type CheckoutReadinessStatus = Schema.Schema.Type<typeof CheckoutReadinessStatusSchema>

export const CheckoutReadinessReasonSchema = Schema.Literal(
  "checkout-blocked",
  "review-signals-present",
  "ready-for-manual-checkout"
)

export type CheckoutReadinessReason = Schema.Schema.Type<typeof CheckoutReadinessReasonSchema>

export const CheckoutReadinessDecisionSchema = Schema.Struct({
  canContinueToManualCheckout: Schema.Boolean,
  checkoutRestrictions: Schema.Array(CheckoutSummarySignalSchema),
  reason: CheckoutReadinessReasonSchema,
  status: CheckoutReadinessStatusSchema,
  warnings: Schema.Array(CheckoutSummaryWarningSchema)
})

export type CheckoutReadinessDecision = Schema.Schema.Type<typeof CheckoutReadinessDecisionSchema>
