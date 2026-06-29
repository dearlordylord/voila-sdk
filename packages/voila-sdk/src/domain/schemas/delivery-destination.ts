import { Schema } from "effect"

export const DeliveryMethodSchema = Schema.Literal("HOME_DELIVERY", "CUSTOMER_COLLECTION")

export type DeliveryMethod = Schema.Schema.Type<typeof DeliveryMethodSchema>

export const DeliveryDestinationsInputSchema = Schema.Struct({
  deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, {
    default: () => "HOME_DELIVERY" as const
  })
})

export type DeliveryDestinationsInput = Schema.Schema.Type<typeof DeliveryDestinationsInputSchema>

export const DeliveryDestinationByIdInputSchema = Schema.Struct({
  deliveryDestinationId: Schema.String.pipe(
    Schema.trimmed(),
    Schema.minLength(1)
  )
})

export type DeliveryDestinationByIdInput = Schema.Schema.Type<typeof DeliveryDestinationByIdInputSchema>

export const RawDeliveryDestinationSchema = Schema.asSchema(
  Schema.Struct({
    addressId: Schema.optionalWith(Schema.String, { exact: true }),
    deliverability: Schema.optionalWith(Schema.String, { exact: true }),
    deliveryDestinationId: Schema.String,
    deliveryInstructions: Schema.optionalWith(Schema.String, { exact: true }),
    deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, { exact: true }),
    formattedAddress: Schema.optionalWith(Schema.String, { exact: true }),
    name: Schema.optionalWith(Schema.String, { exact: true }),
    regionId: Schema.optionalWith(Schema.String, { exact: true }),
    resolvedRegionId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown })))
)

export type RawDeliveryDestination = Schema.Schema.Type<typeof RawDeliveryDestinationSchema>

export const RawDeliveryDestinationsResponseSchema = Schema.Array(RawDeliveryDestinationSchema)

export type RawDeliveryDestinationsResponse = Schema.Schema.Type<typeof RawDeliveryDestinationsResponseSchema>

export const DeliveryDestinationSchema = Schema.Struct({
  deliveryDestinationId: Schema.String,
  deliverable: Schema.Boolean,
  regionId: Schema.optionalWith(Schema.String, { exact: true }),
  deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, { exact: true }),
  addressId: Schema.optionalWith(Schema.String, { exact: true }),
  formattedAddress: Schema.optionalWith(Schema.String, { exact: true }),
  nickname: Schema.optionalWith(Schema.String, { exact: true }),
  deliverability: Schema.optionalWith(Schema.String, { exact: true }),
  deliveryInstructions: Schema.optionalWith(Schema.String, { exact: true })
})

export type DeliveryDestination = Schema.Schema.Type<typeof DeliveryDestinationSchema>

export const NormalizedDeliveryDestinationsSchema = Schema.Struct({
  destinations: Schema.Array(DeliveryDestinationSchema)
})

export type NormalizedDeliveryDestinations = Schema.Schema.Type<typeof NormalizedDeliveryDestinationsSchema>

const DeliveryDestinationDiagnosticItemSchema = Schema.Struct({
  addressId: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  deliverability: Schema.optionalWith(Schema.String, { exact: true }),
  deliverable: Schema.Boolean,
  deliveryDestinationId: Schema.Literal("[redacted]"),
  deliveryInstructions: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, { exact: true }),
  formattedAddress: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  nickname: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true }),
  regionId: Schema.optionalWith(Schema.Literal("[redacted]"), { exact: true })
})

export type DeliveryDestinationDiagnosticItem = Schema.Schema.Type<typeof DeliveryDestinationDiagnosticItemSchema>

export const DeliveryDestinationsDiagnosticSchema = Schema.Struct({
  count: Schema.Number.pipe(
    Schema.finite(),
    Schema.int(),
    Schema.nonNegative()
  ),
  destinations: Schema.Array(DeliveryDestinationDiagnosticItemSchema)
})

export type DeliveryDestinationsDiagnostic = Schema.Schema.Type<typeof DeliveryDestinationsDiagnosticSchema>
