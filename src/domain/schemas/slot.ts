import { Schema } from "effect"

import { MoneySchema } from "./money.js"

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const NonEmptyStringSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))
const PositiveIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.positive()
)

export const SlotDisplayConfigurationSchema = Schema.Literal("CARRIER", "DELIVERY_METHOD")

export type SlotDisplayConfiguration = Schema.Schema.Type<typeof SlotDisplayConfigurationSchema>

export const SlotListingInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyStringSchema,
  displayConfiguration: Schema.optionalWith(SlotDisplayConfigurationSchema, {
    default: () => "DELIVERY_METHOD" as const
  }),
  numberOfDays: Schema.optionalWith(PositiveIntegerSchema, { exact: true }),
  pageViewId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  regionId: NonEmptyStringSchema,
  sessionId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  shippingGroupType: NonEmptyStringSchema,
  viewingLocation: Schema.optionalWith(NonEmptyStringSchema, { exact: true })
})

export type SlotListingInput = Schema.Schema.Type<typeof SlotListingInputSchema>

export const SlotWindowSchema = Schema.asSchema(
  Schema.Struct({
    endTime: Schema.String,
    startTime: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type SlotWindow = Schema.Schema.Type<typeof SlotWindowSchema>

export const OnDemandSlotPropertiesSchema = Schema.asSchema(
  Schema.Struct({
    collectionTimeInMinutes: Schema.optionalWith(Schema.Number.pipe(Schema.finite()), { exact: true }),
    deliveryTimeInMinutes: Schema.optionalWith(Schema.Number.pipe(Schema.finite()), { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type OnDemandSlotProperties = Schema.Schema.Type<typeof OnDemandSlotPropertiesSchema>

export const RawSlotSchema = Schema.asSchema(
  Schema.Struct({
    attributes: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
    deliveryPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    onDemandProperties: Schema.optionalWith(OnDemandSlotPropertiesSchema, { exact: true }),
    slotId: Schema.optionalWith(Schema.String, { exact: true }),
    slotWindow: Schema.optionalWith(SlotWindowSchema, { exact: true }),
    timeZoneId: Schema.optionalWith(Schema.String, { exact: true }),
    title: Schema.optionalWith(Schema.String, { exact: true }),
    type: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlot = Schema.Schema.Type<typeof RawSlotSchema>

export const RawSlotGridDaySchema = Schema.asSchema(
  Schema.Struct({
    day: Schema.String,
    slots: Schema.Array(RawSlotSchema)
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlotGridDay = Schema.Schema.Type<typeof RawSlotGridDaySchema>

export const RawSlotDayMappingSchema = Schema.asSchema(
  Schema.Struct({
    day: Schema.String,
    slotIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
    slotListingId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlotDayMapping = Schema.Schema.Type<typeof RawSlotDayMappingSchema>

export const RawSlotCarrierSchema = Schema.asSchema(
  Schema.Struct({
    carrierDetails: Schema.optionalWith(Schema.Array(Schema.Unknown), { exact: true }),
    carrierId: Schema.optionalWith(Schema.String, { exact: true }),
    carrierName: Schema.optionalWith(Schema.String, { exact: true }),
    daysMapping: Schema.optionalWith(Schema.Array(RawSlotDayMappingSchema), { exact: true }),
    featuredSlots: Schema.optionalWith(Schema.Array(RawSlotSchema), { exact: true }),
    gridSlots: Schema.optionalWith(Schema.Array(RawSlotGridDaySchema), { exact: true }),
    title: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlotCarrier = Schema.Schema.Type<typeof RawSlotCarrierSchema>

export const RawSlotListingResponseSchema = Schema.asSchema(
  Schema.Struct({
    carriers: Schema.Array(RawSlotCarrierSchema),
    days: Schema.optionalWith(
      Schema.Array(
        Schema.Struct({
          date: Schema.String
        }).pipe(Schema.extend(UnknownStringRecordSchema))
      ),
      { exact: true }
    )
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlotListingResponse = Schema.Schema.Type<typeof RawSlotListingResponseSchema>

export const NormalizedSlotSchema = Schema.Struct({
  attributes: Schema.Array(Schema.String),
  available: Schema.Boolean,
  date: Schema.optionalWith(Schema.String, { exact: true }),
  carrierId: Schema.optionalWith(Schema.String, { exact: true }),
  slotListingId: Schema.optionalWith(Schema.String, { exact: true }),
  slotId: Schema.optionalWith(Schema.String, { exact: true }),
  startTime: Schema.optionalWith(Schema.String, { exact: true }),
  endTime: Schema.optionalWith(Schema.String, { exact: true }),
  type: Schema.optionalWith(Schema.String, { exact: true }),
  title: Schema.optionalWith(Schema.String, { exact: true }),
  timeZoneId: Schema.optionalWith(Schema.String, { exact: true }),
  onDemandProperties: Schema.optionalWith(OnDemandSlotPropertiesSchema, { exact: true }),
  deliveryPrice: Schema.optionalWith(MoneySchema, { exact: true })
})

export type NormalizedSlot = Schema.Schema.Type<typeof NormalizedSlotSchema>

export const NormalizedSlotCarrierSchema = Schema.Struct({
  carrierId: Schema.optionalWith(Schema.String, { exact: true }),
  carrierName: Schema.optionalWith(Schema.String, { exact: true }),
  days: Schema.Array(RawSlotDayMappingSchema),
  title: Schema.optionalWith(Schema.String, { exact: true })
})

export type NormalizedSlotCarrier = Schema.Schema.Type<typeof NormalizedSlotCarrierSchema>

export const NormalizedSlotListingSchema = Schema.Struct({
  availableSlotCount: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  carriers: Schema.Array(NormalizedSlotCarrierSchema),
  slots: Schema.Array(NormalizedSlotSchema)
})

export type NormalizedSlotListing = Schema.Schema.Type<typeof NormalizedSlotListingSchema>

export const SlotReservationInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyStringSchema,
  externalAddress: Schema.optionalWith(UnknownStringRecordSchema, { exact: true }),
  regionId: NonEmptyStringSchema,
  slotId: NonEmptyStringSchema
})

export type SlotReservationInput = Schema.Schema.Type<typeof SlotReservationInputSchema>

export const SlotReservationSelectionInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyStringSchema,
  externalAddress: Schema.optionalWith(UnknownStringRecordSchema, { exact: true }),
  regionId: NonEmptyStringSchema,
  slot: NormalizedSlotSchema
})

export type SlotReservationSelectionInput = Schema.Schema.Type<typeof SlotReservationSelectionInputSchema>

export const ReservedSlotSchema = Schema.asSchema(
  Schema.Struct({
    expiryTime: Schema.optionalWith(Schema.String, { exact: true }),
    minimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
    originalMinimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
    slotId: Schema.optionalWith(Schema.String, { exact: true }),
    timeZoneId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type ReservedSlot = Schema.Schema.Type<typeof ReservedSlotSchema>

export const SlotReservationConfirmationDataSchema = Schema.asSchema(
  Schema.Struct({
    draftBasketId: Schema.optionalWith(Schema.String, { exact: true }),
    invalidVouchers: Schema.optionalWith(Schema.Array(Schema.Unknown), { exact: true }),
    regionChanged: Schema.optionalWith(Schema.Boolean, { exact: true }),
    slotRegionId: Schema.optionalWith(Schema.String, { exact: true }),
    totalChanged: Schema.optionalWith(Schema.Boolean, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type SlotReservationConfirmationData = Schema.Schema.Type<
  typeof SlotReservationConfirmationDataSchema
>

export const RawSlotReservationResponseSchema = Schema.asSchema(
  Schema.Struct({
    confirmationData: Schema.optionalWith(SlotReservationConfirmationDataSchema, { exact: true }),
    slot: ReservedSlotSchema
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawSlotReservationResponse = Schema.Schema.Type<typeof RawSlotReservationResponseSchema>

export const NormalizedSlotReservationSchema = Schema.Struct({
  confirmationData: Schema.optionalWith(SlotReservationConfirmationDataSchema, { exact: true }),
  expiryTime: Schema.optionalWith(Schema.String, { exact: true }),
  minimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
  originalMinimumCheckoutThreshold: Schema.optionalWith(MoneySchema, { exact: true }),
  reserved: Schema.Literal(true),
  slotId: Schema.optionalWith(Schema.String, { exact: true }),
  timeZoneId: Schema.optionalWith(Schema.String, { exact: true })
})

export type NormalizedSlotReservation = Schema.Schema.Type<typeof NormalizedSlotReservationSchema>
