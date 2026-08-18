import { Schema } from "effect"

import { MoneySchema } from "./money.js"

import { withUnknownStringFields } from "./unknown-fields.js"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

const CartQuantityDeltaIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.makeFilter((quantity) => quantity !== 0, { message: "Cart quantity delta must not be zero" }))
)

const ProductUuidSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
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
  finalPrice: Schema.optionalKey(MoneySchema),
  maxQuantityReached: Schema.optionalKey(Schema.Boolean),
  price: Schema.optionalKey(MoneySchema),
  productId: Schema.String,
  quantity: NonNegativeIntegerSchema
})

export type CartItem = Schema.Schema.Type<typeof CartItemSchema>

export const CartItemGroupSchema = Schema.Struct({ items: Schema.Array(CartItemSchema) })

export type CartItemGroup = Schema.Schema.Type<typeof CartItemGroupSchema>

export const CartTotalsSchema = Schema.Struct({
  itemPriceAfterPromos: MoneySchema,
  itemsRetailPrice: MoneySchema,
  savingsPrice: MoneySchema,
  taxation: Schema.String
})

export type CartTotals = Schema.Schema.Type<typeof CartTotalsSchema>

export const CartUpdateResultSchema = Schema.Struct({
  itemGroups: Schema.optionalKey(Schema.Array(CartItemGroupSchema)),
  totals: CartTotalsSchema
})

export type CartUpdateResult = Schema.Schema.Type<typeof CartUpdateResultSchema>

const CartViewSignalFieldsSchema = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(Schema.String)
})

export const CartViewSignalSchema = Schema.revealCodec(withUnknownStringFields(CartViewSignalFieldsSchema))

export type CartViewSignal = Schema.Schema.Type<typeof CartViewSignalSchema>

export const LimitedCartItemSchema = Schema.revealCodec(
  withUnknownStringFields(
    Schema.Struct({
      ...CartViewSignalFieldsSchema.fields,
      productId: Schema.String,
      quantity: NonNegativeIntegerSchema,
      reason: Schema.String
    })
  )
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
  available: Schema.optionalKey(Schema.Boolean),
  finalPrice: Schema.optionalKey(MoneySchema),
  imageUrl: Schema.optionalKey(Schema.String),
  maxQuantityReached: Schema.optionalKey(Schema.Boolean),
  name: Schema.optionalKey(Schema.String),
  price: Schema.optionalKey(MoneySchema),
  productId: Schema.String,
  quantity: NonNegativeIntegerSchema,
  retailerProductId: Schema.optionalKey(Schema.String),
  unavailable: Schema.optionalKey(Schema.Boolean)
})

export type CartViewItem = Schema.Schema.Type<typeof CartViewItemSchema>

export const CartViewItemGroupSchema = Schema.Struct({
  items: Schema.Array(CartViewItemSchema),
  name: Schema.optionalKey(Schema.String)
})

export type CartViewItemGroup = Schema.Schema.Type<typeof CartViewItemGroupSchema>

export const CartCheckoutRestrictionSchema = CartViewSignalSchema

export type CartCheckoutRestriction = Schema.Schema.Type<typeof CartCheckoutRestrictionSchema>

export const CartViewResponseSchema = Schema.Struct({
  basket: Schema.Struct({
    basketId: Schema.String,
    itemGroups: Schema.optionalKey(Schema.Array(CartViewItemGroupSchema)),
    totals: CartTotalsSchema
  }),
  checkoutRestrictions: Schema.optionalKey(Schema.Array(CartCheckoutRestrictionSchema)),
  limitedItems: Schema.optionalKey(Schema.Array(CartViewSignalSchema)),
  pricingNotifications: Schema.optionalKey(Schema.Array(CartViewSignalSchema)),
  unavailableData: Schema.optionalKey(Schema.Array(CartViewSignalSchema))
})

export type CartViewResponse = Schema.Schema.Type<typeof CartViewResponseSchema>

export const ActiveCartCheckoutGroupSchema = Schema.revealCodec(
  Schema.Struct({
    checkoutRestrictions: Schema.optionalKey(Schema.Array(Schema.String)),
    itemGroups: Schema.optionalKey(Schema.Array(CartViewItemGroupSchema)),
    totals: Schema.optionalKey(CartTotalsSchema)
  }).pipe(withUnknownStringFields)
)

export type ActiveCartCheckoutGroup = Schema.Schema.Type<typeof ActiveCartCheckoutGroupSchema>

export const ActiveCartViewResponseSchema = Schema.revealCodec(
  Schema.Struct({
    activeCheckoutGroup: Schema.optionalKey(
      Schema.Struct({ checkoutRestrictions: Schema.optionalKey(Schema.Array(Schema.String)) }).pipe(
        withUnknownStringFields
      )
    ),
    cartId: Schema.String,
    checkoutGroups: Schema.optionalKey(
      Schema.Struct({ assignedCheckoutGroups: Schema.optionalKey(Schema.Array(ActiveCartCheckoutGroupSchema)) }).pipe(
        withUnknownStringFields
      )
    ),
    pricingNotifications: Schema.optionalKey(Schema.Array(CartViewSignalSchema)),
    totals: CartTotalsSchema,
    unavailableData: Schema.optionalKey(Schema.Array(CartViewSignalSchema))
  }).pipe(withUnknownStringFields)
)

export type ActiveCartViewResponse = Schema.Schema.Type<typeof ActiveCartViewResponseSchema>

export const AnyCartViewResponseSchema = Schema.Union([CartViewResponseSchema, ActiveCartViewResponseSchema])

export type AnyCartViewResponse = Schema.Schema.Type<typeof AnyCartViewResponseSchema>

export const NormalizedCartItemSchema = CartViewItemSchema.pipe(
  Schema.fieldsAssign({ groupName: Schema.optionalKey(Schema.String) })
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
