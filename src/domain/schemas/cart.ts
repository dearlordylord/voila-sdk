import { Schema } from "effect"

import { MoneySchema } from "./money.js"

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.nonNegative()
)

const CartQuantityDeltaIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.filter((quantity) => quantity !== 0, {
    message: () => "Cart quantity delta must not be zero"
  })
)

const ProductUuidSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
)

export const CartQuantityDeltaSchema = Schema.Struct({
  productId: ProductUuidSchema,
  quantity: CartQuantityDeltaIntegerSchema
})

export type CartQuantityDelta = Schema.Schema.Type<typeof CartQuantityDeltaSchema>

export const CartItemQuantityInputSchema = Schema.Struct({
  productId: NonEmptyTrimmedStringSchema,
  quantity: CartQuantityDeltaIntegerSchema
})

export type CartItemQuantityInput = Schema.Schema.Type<typeof CartItemQuantityInputSchema>

export const CartItemSchema = Schema.Struct({
  finalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
  maxQuantityReached: Schema.optionalWith(Schema.Boolean, { exact: true }),
  price: Schema.optionalWith(MoneySchema, { exact: true }),
  productId: Schema.String,
  quantity: NonNegativeIntegerSchema
})

export type CartItem = Schema.Schema.Type<typeof CartItemSchema>

export const CartItemGroupSchema = Schema.Struct({
  items: Schema.Array(CartItemSchema)
})

export type CartItemGroup = Schema.Schema.Type<typeof CartItemGroupSchema>

export const CartTotalsSchema = Schema.Struct({
  itemPriceAfterPromos: MoneySchema,
  itemsRetailPrice: MoneySchema,
  savingsPrice: MoneySchema,
  taxation: Schema.String
})

export type CartTotals = Schema.Schema.Type<typeof CartTotalsSchema>

export const CartUpdateResultSchema = Schema.Struct({
  itemGroups: Schema.optionalWith(Schema.Array(CartItemGroupSchema), { exact: true }),
  totals: CartTotalsSchema
})

export type CartUpdateResult = Schema.Schema.Type<typeof CartUpdateResultSchema>

export const CartViewSignalSchema = Schema.asSchema(
  Schema.Struct({
    code: Schema.optionalWith(Schema.String, { exact: true }),
    message: Schema.optionalWith(Schema.String, { exact: true }),
    severity: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type CartViewSignal = Schema.Schema.Type<typeof CartViewSignalSchema>

export const LimitedCartItemSchema = Schema.asSchema(
  Schema.Struct({
    productId: Schema.String,
    quantity: NonNegativeIntegerSchema,
    reason: Schema.String
  }).pipe(Schema.extend(CartViewSignalSchema))
)

export type LimitedCartItem = Schema.Schema.Type<typeof LimitedCartItemSchema>

export const CartUpdateResponseSchema = Schema.Struct({
  basketUpdateResult: CartUpdateResultSchema,
  limitedItems: Schema.Array(LimitedCartItemSchema),
  limitedPromotionIds: Schema.Array(Schema.String),
  pricingNotifications: Schema.Array(CartViewSignalSchema),
  unavailableData: Schema.Array(CartViewSignalSchema)
})

export type CartUpdateResponse = Schema.Schema.Type<typeof CartUpdateResponseSchema>

export const NormalizedCartMutationResultSchema = Schema.Struct({
  itemCount: NonNegativeIntegerSchema,
  itemGroups: Schema.Array(CartItemGroupSchema),
  limitedItems: Schema.Array(LimitedCartItemSchema),
  limitedPromotionIds: Schema.Array(Schema.String),
  pricingNotifications: Schema.Array(CartViewSignalSchema),
  totals: CartTotalsSchema,
  unavailableData: Schema.Array(CartViewSignalSchema)
})

export type NormalizedCartMutationResult = Schema.Schema.Type<typeof NormalizedCartMutationResultSchema>

export const CartViewItemSchema = Schema.Struct({
  available: Schema.optionalWith(Schema.Boolean, { exact: true }),
  finalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
  imageUrl: Schema.optionalWith(Schema.String, { exact: true }),
  maxQuantityReached: Schema.optionalWith(Schema.Boolean, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  price: Schema.optionalWith(MoneySchema, { exact: true }),
  productId: Schema.String,
  quantity: NonNegativeIntegerSchema,
  retailerProductId: Schema.optionalWith(Schema.String, { exact: true }),
  unavailable: Schema.optionalWith(Schema.Boolean, { exact: true })
})

export type CartViewItem = Schema.Schema.Type<typeof CartViewItemSchema>

export const CartViewItemGroupSchema = Schema.Struct({
  items: Schema.Array(CartViewItemSchema),
  name: Schema.optionalWith(Schema.String, { exact: true })
})

export type CartViewItemGroup = Schema.Schema.Type<typeof CartViewItemGroupSchema>

export const CartCheckoutRestrictionSchema = CartViewSignalSchema

export type CartCheckoutRestriction = Schema.Schema.Type<typeof CartCheckoutRestrictionSchema>

export const CartViewResponseSchema = Schema.Struct({
  basket: Schema.Struct({
    basketId: Schema.String,
    itemGroups: Schema.optionalWith(Schema.Array(CartViewItemGroupSchema), { exact: true }),
    totals: CartTotalsSchema
  }),
  checkoutRestrictions: Schema.optionalWith(Schema.Array(CartCheckoutRestrictionSchema), { exact: true }),
  limitedItems: Schema.optionalWith(Schema.Array(CartViewSignalSchema), { exact: true }),
  pricingNotifications: Schema.optionalWith(Schema.Array(CartViewSignalSchema), { exact: true }),
  unavailableData: Schema.optionalWith(Schema.Array(CartViewSignalSchema), { exact: true })
})

export type CartViewResponse = Schema.Schema.Type<typeof CartViewResponseSchema>

export const ActiveCartCheckoutGroupSchema = Schema.asSchema(
  Schema.Struct({
    checkoutRestrictions: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
    itemGroups: Schema.optionalWith(Schema.Array(CartViewItemGroupSchema), { exact: true }),
    totals: Schema.optionalWith(CartTotalsSchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type ActiveCartCheckoutGroup = Schema.Schema.Type<typeof ActiveCartCheckoutGroupSchema>

export const ActiveCartViewResponseSchema = Schema.asSchema(
  Schema.Struct({
    activeCheckoutGroup: Schema.optionalWith(
      Schema.Struct({
        checkoutRestrictions: Schema.optionalWith(Schema.Array(Schema.String), { exact: true })
      }).pipe(Schema.extend(UnknownStringRecordSchema)),
      { exact: true }
    ),
    cartId: Schema.String,
    checkoutGroups: Schema.optionalWith(
      Schema.Struct({
        assignedCheckoutGroups: Schema.optionalWith(Schema.Array(ActiveCartCheckoutGroupSchema), { exact: true })
      }).pipe(Schema.extend(UnknownStringRecordSchema)),
      { exact: true }
    ),
    pricingNotifications: Schema.optionalWith(Schema.Array(CartViewSignalSchema), { exact: true }),
    totals: CartTotalsSchema,
    unavailableData: Schema.optionalWith(Schema.Array(CartViewSignalSchema), { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type ActiveCartViewResponse = Schema.Schema.Type<typeof ActiveCartViewResponseSchema>

export const AnyCartViewResponseSchema = Schema.Union(CartViewResponseSchema, ActiveCartViewResponseSchema)

export type AnyCartViewResponse = Schema.Schema.Type<typeof AnyCartViewResponseSchema>

export const NormalizedCartItemSchema = CartViewItemSchema.pipe(
  Schema.extend(Schema.Struct({
    groupName: Schema.optionalWith(Schema.String, { exact: true })
  }))
)

export type NormalizedCartItem = Schema.Schema.Type<typeof NormalizedCartItemSchema>

export const NormalizedCartViewSchema = Schema.Struct({
  basketId: Schema.String,
  checkoutRestrictions: Schema.Array(CartCheckoutRestrictionSchema),
  itemCount: NonNegativeIntegerSchema,
  items: Schema.Array(NormalizedCartItemSchema),
  limitedItems: Schema.Array(CartViewSignalSchema),
  pricingNotifications: Schema.Array(CartViewSignalSchema),
  totals: CartTotalsSchema,
  unavailableData: Schema.Array(CartViewSignalSchema)
})

export type NormalizedCartView = Schema.Schema.Type<typeof NormalizedCartViewSchema>
