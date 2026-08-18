import { Effect, Schema } from "effect"

import { withUnknownStringFields } from "./unknown-fields.js"

export const DeliveryMethodSchema = Schema.Literals(["HOME_DELIVERY", "CUSTOMER_COLLECTION"])

export type DeliveryMethod = Schema.Schema.Type<typeof DeliveryMethodSchema>

export const DeliveryDestinationsInputSchema = Schema.Struct({
  deliveryMethod: DeliveryMethodSchema.pipe(
    Schema.withDecodingDefaultType(Effect.succeed<DeliveryMethod>("HOME_DELIVERY"))
  )
})

export type DeliveryDestinationsInput = Schema.Schema.Type<typeof DeliveryDestinationsInputSchema>

export const DeliveryDestinationByIdInputSchema = Schema.Struct({
  deliveryDestinationId: Schema.String.pipe(Schema.check(Schema.isTrimmed()), Schema.check(Schema.isMinLength(1)))
})

export type DeliveryDestinationByIdInput = Schema.Schema.Type<typeof DeliveryDestinationByIdInputSchema>

export const RawDeliveryDestinationSchema = Schema.revealCodec(
  Schema.Struct({
    addressId: Schema.optionalKey(Schema.String),
    deliverability: Schema.optionalKey(Schema.String),
    deliveryDestinationId: Schema.String,
    deliveryInstructions: Schema.optionalKey(Schema.String),
    deliveryMethod: Schema.optionalKey(DeliveryMethodSchema),
    formattedAddress: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
    regionId: Schema.optionalKey(Schema.String),
    resolvedRegionId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawDeliveryDestination = Schema.Schema.Type<typeof RawDeliveryDestinationSchema>

export const RawDeliveryDestinationsResponseSchema = Schema.Array(RawDeliveryDestinationSchema)

export type RawDeliveryDestinationsResponse = Schema.Schema.Type<typeof RawDeliveryDestinationsResponseSchema>

export const DeliveryDestinationSchema = Schema.Struct({
  deliveryDestinationId: Schema.String,
  deliverable: Schema.Boolean,
  regionId: Schema.optionalKey(Schema.String),
  deliveryMethod: Schema.optionalKey(DeliveryMethodSchema),
  addressId: Schema.optionalKey(Schema.String),
  formattedAddress: Schema.optionalKey(Schema.String),
  nickname: Schema.optionalKey(Schema.String),
  deliverability: Schema.optionalKey(Schema.String),
  deliveryInstructions: Schema.optionalKey(Schema.String)
})

export type DeliveryDestination = Schema.Schema.Type<typeof DeliveryDestinationSchema>

export const NormalizedDeliveryDestinationsSchema = Schema.Struct({
  destinations: Schema.Array(DeliveryDestinationSchema)
})

export type NormalizedDeliveryDestinations = Schema.Schema.Type<typeof NormalizedDeliveryDestinationsSchema>

const DeliveryDestinationDiagnosticItemSchema = Schema.Struct({
  addressId: Schema.optionalKey(Schema.Literal("[redacted]")),
  deliverability: Schema.optionalKey(Schema.String),
  deliverable: Schema.Boolean,
  deliveryDestinationId: Schema.Literal("[redacted]"),
  deliveryInstructions: Schema.optionalKey(Schema.Literal("[redacted]")),
  deliveryMethod: Schema.optionalKey(DeliveryMethodSchema),
  formattedAddress: Schema.optionalKey(Schema.Literal("[redacted]")),
  nickname: Schema.optionalKey(Schema.Literal("[redacted]")),
  regionId: Schema.optionalKey(Schema.Literal("[redacted]"))
})

export type DeliveryDestinationDiagnosticItem = Schema.Schema.Type<typeof DeliveryDestinationDiagnosticItemSchema>

export const DeliveryDestinationsDiagnosticSchema = Schema.Struct({
  count: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  destinations: Schema.Array(DeliveryDestinationDiagnosticItemSchema)
})

export type DeliveryDestinationsDiagnostic = Schema.Schema.Type<typeof DeliveryDestinationsDiagnosticSchema>
