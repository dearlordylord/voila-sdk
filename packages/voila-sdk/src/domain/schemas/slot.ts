import { Effect, Schema } from "effect"

import { MoneySchema } from "./money.js"

import { withUnknownStringFields } from "./unknown-fields.js"

const UnknownStringRecordSchema = Schema.Record(Schema.String, Schema.Unknown)
const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isTrimmed()), Schema.check(Schema.isMinLength(1)))
const PositiveIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0))
)

export const SlotDisplayConfigurationSchema = Schema.Literals(["CARRIER", "DELIVERY_METHOD"])

export type SlotDisplayConfiguration = Schema.Schema.Type<typeof SlotDisplayConfigurationSchema>

export const SlotListingInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyStringSchema,
  displayConfiguration: SlotDisplayConfigurationSchema.pipe(
    Schema.withDecodingDefaultType(Effect.succeed<SlotDisplayConfiguration>("DELIVERY_METHOD"))
  ),
  numberOfDays: Schema.optionalKey(PositiveIntegerSchema),
  pageViewId: Schema.optionalKey(NonEmptyStringSchema),
  regionId: NonEmptyStringSchema,
  sessionId: Schema.optionalKey(NonEmptyStringSchema),
  shippingGroupType: NonEmptyStringSchema,
  viewingLocation: Schema.optionalKey(NonEmptyStringSchema)
})

export type SlotListingInput = Schema.Schema.Type<typeof SlotListingInputSchema>

export const SlotWindowSchema = Schema.revealCodec(
  Schema.Struct({ endTime: Schema.String, startTime: Schema.String }).pipe(withUnknownStringFields)
)

export type SlotWindow = Schema.Schema.Type<typeof SlotWindowSchema>

export const OnDemandSlotPropertiesSchema = Schema.revealCodec(
  Schema.Struct({
    collectionTimeInMinutes: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
    deliveryTimeInMinutes: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite())))
  }).pipe(withUnknownStringFields)
)

export type OnDemandSlotProperties = Schema.Schema.Type<typeof OnDemandSlotPropertiesSchema>

export const RawSlotSchema = Schema.revealCodec(
  Schema.Struct({
    attributes: Schema.optionalKey(Schema.Array(Schema.String)),
    deliveryPrice: Schema.optionalKey(MoneySchema),
    onDemandProperties: Schema.optionalKey(OnDemandSlotPropertiesSchema),
    slotId: Schema.optionalKey(Schema.String),
    slotWindow: Schema.optionalKey(SlotWindowSchema),
    timeZoneId: Schema.optionalKey(Schema.String),
    title: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawSlot = Schema.Schema.Type<typeof RawSlotSchema>

export const RawSlotGridDaySchema = Schema.revealCodec(
  Schema.Struct({ day: Schema.String, slots: Schema.Array(RawSlotSchema) }).pipe(withUnknownStringFields)
)

export type RawSlotGridDay = Schema.Schema.Type<typeof RawSlotGridDaySchema>

export const RawSlotDayMappingSchema = Schema.revealCodec(
  Schema.Struct({
    day: Schema.String,
    slotIds: Schema.optionalKey(Schema.Array(Schema.String)),
    slotListingId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawSlotDayMapping = Schema.Schema.Type<typeof RawSlotDayMappingSchema>

export const RawSlotCarrierSchema = Schema.revealCodec(
  Schema.Struct({
    carrierDetails: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    carrierId: Schema.optionalKey(Schema.String),
    carrierName: Schema.optionalKey(Schema.String),
    daysMapping: Schema.optionalKey(Schema.Array(RawSlotDayMappingSchema)),
    featuredSlots: Schema.optionalKey(Schema.Array(RawSlotSchema)),
    gridSlots: Schema.optionalKey(Schema.Array(RawSlotGridDaySchema)),
    title: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawSlotCarrier = Schema.Schema.Type<typeof RawSlotCarrierSchema>

export const RawSlotListingResponseSchema = Schema.revealCodec(
  Schema.Struct({
    carriers: Schema.Array(RawSlotCarrierSchema),
    days: Schema.optionalKey(Schema.Array(Schema.Struct({ date: Schema.String }).pipe(withUnknownStringFields)))
  }).pipe(withUnknownStringFields)
)

export type RawSlotListingResponse = Schema.Schema.Type<typeof RawSlotListingResponseSchema>

export const NormalizedSlotSchema = Schema.Struct({
  attributes: Schema.Array(Schema.String),
  available: Schema.Boolean,
  date: Schema.optionalKey(Schema.String),
  carrierId: Schema.optionalKey(Schema.String),
  slotListingId: Schema.optionalKey(Schema.String),
  slotId: Schema.optionalKey(Schema.String),
  startTime: Schema.optionalKey(Schema.String),
  endTime: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  timeZoneId: Schema.optionalKey(Schema.String),
  onDemandProperties: Schema.optionalKey(OnDemandSlotPropertiesSchema),
  deliveryPrice: Schema.optionalKey(MoneySchema)
})

export type NormalizedSlot = Schema.Schema.Type<typeof NormalizedSlotSchema>

export const NormalizedSlotCarrierSchema = Schema.Struct({
  carrierId: Schema.optionalKey(Schema.String),
  carrierName: Schema.optionalKey(Schema.String),
  days: Schema.Array(RawSlotDayMappingSchema),
  title: Schema.optionalKey(Schema.String)
})

export type NormalizedSlotCarrier = Schema.Schema.Type<typeof NormalizedSlotCarrierSchema>

export const NormalizedSlotListingSchema = Schema.Struct({
  availableSlotCount: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  carriers: Schema.Array(NormalizedSlotCarrierSchema),
  slots: Schema.Array(NormalizedSlotSchema)
})

export type NormalizedSlotListing = Schema.Schema.Type<typeof NormalizedSlotListingSchema>

export const SlotReservationInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyStringSchema,
  externalAddress: Schema.optionalKey(UnknownStringRecordSchema),
  regionId: NonEmptyStringSchema,
  slotId: NonEmptyStringSchema
})

export type SlotReservationInput = Schema.Schema.Type<typeof SlotReservationInputSchema>

export const SlotReservationSelectionInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyStringSchema,
  externalAddress: Schema.optionalKey(UnknownStringRecordSchema),
  regionId: NonEmptyStringSchema,
  slot: NormalizedSlotSchema
})

export type SlotReservationSelectionInput = Schema.Schema.Type<typeof SlotReservationSelectionInputSchema>

export const ReservedSlotSchema = Schema.revealCodec(
  Schema.Struct({
    expiryTime: Schema.optionalKey(Schema.String),
    minimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
    originalMinimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
    slotId: Schema.optionalKey(Schema.String),
    timeZoneId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type ReservedSlot = Schema.Schema.Type<typeof ReservedSlotSchema>

export const SlotReservationConfirmationDataSchema = Schema.revealCodec(
  Schema.Struct({
    draftBasketId: Schema.optionalKey(Schema.String),
    invalidVouchers: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    regionChanged: Schema.optionalKey(Schema.Boolean),
    slotRegionId: Schema.optionalKey(Schema.String),
    totalChanged: Schema.optionalKey(Schema.Boolean)
  }).pipe(withUnknownStringFields)
)

export type SlotReservationConfirmationData = Schema.Schema.Type<typeof SlotReservationConfirmationDataSchema>

export const RawSlotReservationResponseSchema = Schema.revealCodec(
  Schema.Struct({
    confirmationData: Schema.optionalKey(SlotReservationConfirmationDataSchema),
    slot: ReservedSlotSchema
  }).pipe(withUnknownStringFields)
)

export type RawSlotReservationResponse = Schema.Schema.Type<typeof RawSlotReservationResponseSchema>

export const NormalizedSlotReservationSchema = Schema.Struct({
  confirmationData: Schema.optionalKey(SlotReservationConfirmationDataSchema),
  expiryTime: Schema.optionalKey(Schema.String),
  minimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
  originalMinimumCheckoutThreshold: Schema.optionalKey(MoneySchema),
  reserved: Schema.Literal(true),
  slotId: Schema.optionalKey(Schema.String),
  timeZoneId: Schema.optionalKey(Schema.String)
})

export type NormalizedSlotReservation = Schema.Schema.Type<typeof NormalizedSlotReservationSchema>
