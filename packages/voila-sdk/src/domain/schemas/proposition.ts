import { Schema } from "effect"

import { DeliveryMethodSchema } from "./delivery-destination.js"

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const NonEmptyStringSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))

export const ActiveShoppingContextInputSchema = Schema.Struct({
  regionId: Schema.optionalWith(NonEmptyStringSchema, { exact: true })
})

export type ActiveShoppingContextInput = Schema.Schema.Type<typeof ActiveShoppingContextInputSchema>

export const DeliveryPropositionDetailsInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyStringSchema,
  regionId: NonEmptyStringSchema
})

export type DeliveryPropositionDetailsInput = Schema.Schema.Type<typeof DeliveryPropositionDetailsInputSchema>

export const DeliveryContextPreviewInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyStringSchema,
  destinationRegionId: NonEmptyStringSchema
})

export type DeliveryContextPreviewInput = Schema.Schema.Type<typeof DeliveryContextPreviewInputSchema>

export const SetActiveDeliveryDestinationInputSchema = Schema.Struct({
  customerId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  deliveryDestinationId: NonEmptyStringSchema,
  regionId: NonEmptyStringSchema,
  visitorId: Schema.optionalWith(NonEmptyStringSchema, { exact: true })
})

export type SetActiveDeliveryDestinationInput = Schema.Schema.Type<
  typeof SetActiveDeliveryDestinationInputSchema
>

export const SetActiveCartPropositionInputSchema = Schema.Struct({
  customerId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  destinationCartPropositionId: NonEmptyStringSchema,
  originCartPropositionId: NonEmptyStringSchema,
  visitorId: Schema.optionalWith(NonEmptyStringSchema, { exact: true })
})

export type SetActiveCartPropositionInput = Schema.Schema.Type<typeof SetActiveCartPropositionInputSchema>

export const ApplyDeliveryContextChangeInputSchema = Schema.Struct({
  allowCartImpact: Schema.optionalWith(Schema.Boolean, {
    default: () => false
  }),
  customerId: Schema.optionalWith(NonEmptyStringSchema, { exact: true }),
  deliveryDestinationId: NonEmptyStringSchema,
  destinationRegionId: NonEmptyStringSchema,
  visitorId: Schema.optionalWith(NonEmptyStringSchema, { exact: true })
})

export type ApplyDeliveryContextChangeInput = Schema.Schema.Type<
  typeof ApplyDeliveryContextChangeInputSchema
>

export const SupportedDeliveryPropositionSchema = Schema.asSchema(
  Schema.Struct({
    deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, { exact: true }),
    deliveryPropositionId: Schema.String,
    details: Schema.optionalWith(
      Schema.Struct({
        iconUrl: Schema.optionalWith(Schema.String, { exact: true }),
        name: Schema.optionalWith(Schema.String, { exact: true })
      }).pipe(Schema.extend(UnknownStringRecordSchema)),
      { exact: true }
    ),
    isDefault: Schema.optionalWith(Schema.Boolean, { exact: true }),
    propositionType: Schema.optionalWith(Schema.String, { exact: true }),
    regionId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type SupportedDeliveryProposition = Schema.Schema.Type<
  typeof SupportedDeliveryPropositionSchema
>

export const DeliveryPropositionDetailsResponseSchema = Schema.Union(
  Schema.Array(SupportedDeliveryPropositionSchema),
  Schema.asSchema(
    Schema.Struct({
      propositions: Schema.Array(SupportedDeliveryPropositionSchema)
    }).pipe(Schema.extend(UnknownStringRecordSchema))
  )
)

export type DeliveryPropositionDetailsResponse = Schema.Schema.Type<
  typeof DeliveryPropositionDetailsResponseSchema
>

export const NormalizedDeliveryPropositionDetailsSchema = Schema.Struct({
  propositions: Schema.Array(SupportedDeliveryPropositionSchema)
})

export type NormalizedDeliveryPropositionDetails = Schema.Schema.Type<
  typeof NormalizedDeliveryPropositionDetailsSchema
>

export const CartImpactProductSchema = Schema.asSchema(
  Schema.Struct({
    actualAmount: Schema.optionalWith(Schema.Number.pipe(Schema.finite()), { exact: true }),
    expectedAmount: Schema.optionalWith(Schema.Number.pipe(Schema.finite()), { exact: true }),
    name: Schema.optionalWith(Schema.String, { exact: true }),
    productId: Schema.optionalWith(Schema.String, { exact: true }),
    quantity: Schema.optionalWith(Schema.Number.pipe(Schema.finite(), Schema.int()), { exact: true }),
    retailerProductId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CartImpactProduct = Schema.Schema.Type<typeof CartImpactProductSchema>

export const CartPropositionCheckoutGroupSchema = Schema.asSchema(
  Schema.Struct({
    limitedItems: Schema.optionalWith(Schema.Array(CartImpactProductSchema), { exact: true }),
    products: Schema.optionalWith(Schema.Array(CartImpactProductSchema), { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CartPropositionCheckoutGroup = Schema.Schema.Type<
  typeof CartPropositionCheckoutGroupSchema
>

export const CartPropositionSchema = Schema.asSchema(
  Schema.Struct({
    assignedCheckoutGroups: Schema.optionalWith(Schema.Array(CartPropositionCheckoutGroupSchema), {
      exact: true
    }),
    cartPropositionId: Schema.optionalWith(Schema.String, { exact: true }),
    regionId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CartProposition = Schema.Schema.Type<typeof CartPropositionSchema>

export const DeliveryContextPreviewResponseSchema = Schema.asSchema(
  Schema.Struct({
    destinationCartProposition: CartPropositionSchema,
    originCartProposition: Schema.optionalWith(CartPropositionSchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type DeliveryContextPreviewResponse = Schema.Schema.Type<
  typeof DeliveryContextPreviewResponseSchema
>

export const CartImpactWarningSchema = Schema.Struct({
  kind: Schema.Literal("origin-cart-items", "destination-cart-items", "limited-cart-items"),
  products: Schema.Array(CartImpactProductSchema)
})

export type CartImpactWarning = Schema.Schema.Type<typeof CartImpactWarningSchema>

export const NormalizedDeliveryContextPreviewSchema = Schema.Struct({
  cartImpactWarnings: Schema.Array(CartImpactWarningSchema),
  destinationCartPropositionId: Schema.optionalWith(Schema.String, { exact: true }),
  destinationRegionId: Schema.optionalWith(Schema.String, { exact: true }),
  originCartPropositionId: Schema.optionalWith(Schema.String, { exact: true }),
  originRegionId: Schema.optionalWith(Schema.String, { exact: true }),
  requiresConfirmation: Schema.Boolean
})

export type NormalizedDeliveryContextPreview = Schema.Schema.Type<
  typeof NormalizedDeliveryContextPreviewSchema
>

export const NormalizedActiveShoppingContextSchema = Schema.Struct({
  cartPropositionId: Schema.optionalWith(Schema.String, { exact: true }),
  deliveryDestinationId: Schema.optionalWith(Schema.String, { exact: true }),
  deliveryMethod: Schema.optionalWith(DeliveryMethodSchema, { exact: true }),
  propositionType: Schema.optionalWith(Schema.String, { exact: true }),
  regionId: Schema.optionalWith(Schema.String, { exact: true }),
  type: Schema.optionalWith(Schema.String, { exact: true })
})

export const ActiveShoppingContextResponseSchema = Schema.asSchema(
  NormalizedActiveShoppingContextSchema.pipe(Schema.extend(UnknownStringRecordSchema))
)

export type ActiveShoppingContextResponse = Schema.Schema.Type<typeof ActiveShoppingContextResponseSchema>

export type NormalizedActiveShoppingContext = Schema.Schema.Type<
  typeof NormalizedActiveShoppingContextSchema
>

export const DeliveryContextAppliedResultSchema = Schema.Struct({
  applied: Schema.Literal(true),
  context: NormalizedActiveShoppingContextSchema,
  preview: NormalizedDeliveryContextPreviewSchema,
  status: Schema.Literal("applied")
})

export type DeliveryContextAppliedResult = Schema.Schema.Type<
  typeof DeliveryContextAppliedResultSchema
>

export const DeliveryContextRequiresConfirmationResultSchema = Schema.Struct({
  applied: Schema.Literal(false),
  preview: NormalizedDeliveryContextPreviewSchema,
  status: Schema.Literal("requires-confirmation")
})

export type DeliveryContextRequiresConfirmationResult = Schema.Schema.Type<
  typeof DeliveryContextRequiresConfirmationResultSchema
>

export const DeliveryContextChangeResultSchema = Schema.Union(
  DeliveryContextAppliedResultSchema,
  DeliveryContextRequiresConfirmationResultSchema
)

export type DeliveryContextChangeResult = Schema.Schema.Type<typeof DeliveryContextChangeResultSchema>
