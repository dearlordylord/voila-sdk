import { Effect, Schema } from "effect"

import { DeliveryMethodSchema } from "./delivery-destination.js"

import { withUnknownStringFields } from "./unknown-fields.js"

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isTrimmed()), Schema.check(Schema.isMinLength(1)))

export const ActiveShoppingContextInputSchema = Schema.Struct({ regionId: Schema.optionalKey(NonEmptyStringSchema) })

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
  customerId: Schema.optionalKey(NonEmptyStringSchema),
  deliveryDestinationId: NonEmptyStringSchema,
  regionId: NonEmptyStringSchema,
  visitorId: Schema.optionalKey(NonEmptyStringSchema)
})

export type SetActiveDeliveryDestinationInput = Schema.Schema.Type<typeof SetActiveDeliveryDestinationInputSchema>

export const SetActiveCartPropositionInputSchema = Schema.Struct({
  customerId: Schema.optionalKey(NonEmptyStringSchema),
  destinationCartPropositionId: NonEmptyStringSchema,
  originCartPropositionId: NonEmptyStringSchema,
  visitorId: Schema.optionalKey(NonEmptyStringSchema)
})

export type SetActiveCartPropositionInput = Schema.Schema.Type<typeof SetActiveCartPropositionInputSchema>

export const ApplyDeliveryContextChangeInputSchema = Schema.Struct({
  allowCartImpact: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.succeed(false))),
  customerId: Schema.optionalKey(NonEmptyStringSchema),
  deliveryDestinationId: NonEmptyStringSchema,
  destinationRegionId: NonEmptyStringSchema,
  visitorId: Schema.optionalKey(NonEmptyStringSchema)
})

export type ApplyDeliveryContextChangeInput = Schema.Schema.Type<typeof ApplyDeliveryContextChangeInputSchema>

export const SupportedDeliveryPropositionSchema = Schema.revealCodec(
  Schema.Struct({
    deliveryMethod: Schema.optionalKey(DeliveryMethodSchema),
    deliveryPropositionId: Schema.String,
    details: Schema.optionalKey(
      Schema.Struct({ iconUrl: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) }).pipe(
        withUnknownStringFields
      )
    ),
    isDefault: Schema.optionalKey(Schema.Boolean),
    propositionType: Schema.optionalKey(Schema.String),
    regionId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type SupportedDeliveryProposition = Schema.Schema.Type<typeof SupportedDeliveryPropositionSchema>

export const DeliveryPropositionDetailsResponseSchema = Schema.Union([
  Schema.Array(SupportedDeliveryPropositionSchema),
  Schema.revealCodec(
    Schema.Struct({ propositions: Schema.Array(SupportedDeliveryPropositionSchema) }).pipe(withUnknownStringFields)
  )
])

export type DeliveryPropositionDetailsResponse = Schema.Schema.Type<typeof DeliveryPropositionDetailsResponseSchema>

export const NormalizedDeliveryPropositionDetailsSchema = Schema.Struct({
  propositions: Schema.Array(SupportedDeliveryPropositionSchema)
})

export type NormalizedDeliveryPropositionDetails = Schema.Schema.Type<typeof NormalizedDeliveryPropositionDetailsSchema>

export const CartImpactProductSchema = Schema.revealCodec(
  Schema.Struct({
    actualAmount: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
    expectedAmount: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
    name: Schema.optionalKey(Schema.String),
    productId: Schema.optionalKey(Schema.String),
    quantity: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.check(Schema.isInt()))),
    retailerProductId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type CartImpactProduct = Schema.Schema.Type<typeof CartImpactProductSchema>

export const CartPropositionCheckoutGroupSchema = Schema.revealCodec(
  Schema.Struct({
    limitedItems: Schema.optionalKey(Schema.Array(CartImpactProductSchema)),
    products: Schema.optionalKey(Schema.Array(CartImpactProductSchema))
  }).pipe(withUnknownStringFields)
)

export type CartPropositionCheckoutGroup = Schema.Schema.Type<typeof CartPropositionCheckoutGroupSchema>

export const CartPropositionSchema = Schema.revealCodec(
  Schema.Struct({
    assignedCheckoutGroups: Schema.optionalKey(Schema.Array(CartPropositionCheckoutGroupSchema)),
    cartPropositionId: Schema.optionalKey(Schema.String),
    regionId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type CartProposition = Schema.Schema.Type<typeof CartPropositionSchema>

export const DeliveryContextPreviewResponseSchema = Schema.revealCodec(
  Schema.Struct({
    destinationCartProposition: CartPropositionSchema,
    originCartProposition: Schema.optionalKey(CartPropositionSchema)
  }).pipe(withUnknownStringFields)
)

export type DeliveryContextPreviewResponse = Schema.Schema.Type<typeof DeliveryContextPreviewResponseSchema>

export const CartImpactWarningSchema = Schema.Struct({
  kind: Schema.Literals(["origin-cart-items", "destination-cart-items", "limited-cart-items"]),
  products: Schema.Array(CartImpactProductSchema)
})

export type CartImpactWarning = Schema.Schema.Type<typeof CartImpactWarningSchema>

export const NormalizedDeliveryContextPreviewSchema = Schema.Struct({
  cartImpactWarnings: Schema.Array(CartImpactWarningSchema),
  destinationCartPropositionId: Schema.optionalKey(Schema.String),
  destinationRegionId: Schema.optionalKey(Schema.String),
  originCartPropositionId: Schema.optionalKey(Schema.String),
  originRegionId: Schema.optionalKey(Schema.String),
  requiresConfirmation: Schema.Boolean
})

export type NormalizedDeliveryContextPreview = Schema.Schema.Type<typeof NormalizedDeliveryContextPreviewSchema>

export const NormalizedActiveShoppingContextSchema = Schema.Struct({
  cartPropositionId: Schema.optionalKey(Schema.String),
  deliveryDestinationId: Schema.optionalKey(Schema.String),
  deliveryMethod: Schema.optionalKey(DeliveryMethodSchema),
  propositionType: Schema.optionalKey(Schema.String),
  regionId: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String)
})

export const ActiveShoppingContextResponseSchema = Schema.revealCodec(
  NormalizedActiveShoppingContextSchema.pipe(withUnknownStringFields)
)

export type ActiveShoppingContextResponse = Schema.Schema.Type<typeof ActiveShoppingContextResponseSchema>

export type NormalizedActiveShoppingContext = Schema.Schema.Type<typeof NormalizedActiveShoppingContextSchema>

export const DeliveryContextAppliedResultSchema = Schema.Struct({
  applied: Schema.Literal(true),
  context: NormalizedActiveShoppingContextSchema,
  preview: NormalizedDeliveryContextPreviewSchema,
  status: Schema.Literal("applied")
})

export type DeliveryContextAppliedResult = Schema.Schema.Type<typeof DeliveryContextAppliedResultSchema>

export const DeliveryContextRequiresConfirmationResultSchema = Schema.Struct({
  applied: Schema.Literal(false),
  preview: NormalizedDeliveryContextPreviewSchema,
  status: Schema.Literal("requires-confirmation")
})

export type DeliveryContextRequiresConfirmationResult = Schema.Schema.Type<
  typeof DeliveryContextRequiresConfirmationResultSchema
>

export const DeliveryContextChangeResultSchema = Schema.Union([
  DeliveryContextAppliedResultSchema,
  DeliveryContextRequiresConfirmationResultSchema
])

export type DeliveryContextChangeResult = Schema.Schema.Type<typeof DeliveryContextChangeResultSchema>
