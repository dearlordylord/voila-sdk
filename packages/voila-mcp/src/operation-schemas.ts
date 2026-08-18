import { Schema } from "effect"

import { maximumOrderPageSize, maximumProductPageSize } from "./operation-limits.js"

const NonEmptyTrimmedStringSchema = Schema.Trimmed.check(Schema.isNonEmpty())
const IsoDateStringSchema = NonEmptyTrimmedStringSchema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

const PageSizeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumProductPageSize)
)

const NonNegativeNumberSchema = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

const PositiveIntegerSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

const OrderPageSizeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumOrderPageSize)
)

const QuantitySchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

const UnknownStringRecordSchema = Schema.Record(Schema.String, Schema.Unknown)

export const EmptyOperationInputSchema = Schema.Record(Schema.String, Schema.Never)

export type EmptyOperationInput = Schema.Schema.Type<typeof EmptyOperationInputSchema>

export const ActiveShoppingContextOperationInputSchema = Schema.Struct({
  regionId: Schema.optionalKey(NonEmptyTrimmedStringSchema)
})

export type ActiveShoppingContextOperationInput = Schema.Schema.Type<typeof ActiveShoppingContextOperationInputSchema>

export const SlotDisplayConfigurationOperationInputSchema = Schema.Literals(["DELIVERY_METHOD", "CARRIER"])

export const SlotListingsOperationInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyTrimmedStringSchema,
  displayConfiguration: Schema.optionalKey(SlotDisplayConfigurationOperationInputSchema),
  numberOfDays: Schema.optionalKey(PositiveIntegerSchema),
  regionId: NonEmptyTrimmedStringSchema,
  shippingGroupType: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  viewingLocation: Schema.optionalKey(NonEmptyTrimmedStringSchema)
})

export type SlotListingsOperationInput = Schema.Schema.Type<typeof SlotListingsOperationInputSchema>

export const SlotReservationOperationInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyTrimmedStringSchema,
  externalAddress: Schema.optionalKey(UnknownStringRecordSchema),
  regionId: NonEmptyTrimmedStringSchema,
  slotId: NonEmptyTrimmedStringSchema
})

export type SlotReservationOperationInput = Schema.Schema.Type<typeof SlotReservationOperationInputSchema>

export const ProductListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalKey(PageSizeSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  query: NonEmptyTrimmedStringSchema
})

export type ProductListOperationInput = Schema.Schema.Type<typeof ProductListOperationInputSchema>

export const DiscountSortOperationInputSchema = Schema.Literals(["best-percent", "best-amount", "price-asc"])

export const DiscountedProductsOperationInputSchema = Schema.Struct({
  categoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  minSavingsAmount: Schema.optionalKey(NonNegativeNumberSchema),
  minSavingsPercent: Schema.optionalKey(NonNegativeNumberSchema),
  pageSize: Schema.optionalKey(PageSizeSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  query: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  retailerCategoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  sort: Schema.optionalKey(DiscountSortOperationInputSchema)
})

export type DiscountedProductsOperationInput = Schema.Schema.Type<typeof DiscountedProductsOperationInputSchema>

export const CategoryProductsOperationInputSchema = Schema.Struct({
  categoryId: NonEmptyTrimmedStringSchema,
  pageSize: Schema.optionalKey(PageSizeSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema)
})

export type CategoryProductsOperationInput = Schema.Schema.Type<typeof CategoryProductsOperationInputSchema>

export const OrderListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalKey(OrderPageSizeSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema)
})

export type OrderListOperationInput = Schema.Schema.Type<typeof OrderListOperationInputSchema>

export const OrderDetailsOperationInputSchema = Schema.Struct({ orderId: NonEmptyTrimmedStringSchema })

export type OrderDetailsOperationInput = Schema.Schema.Type<typeof OrderDetailsOperationInputSchema>

export const OrderItemsOperationInputSchema = Schema.Struct({
  fromDate: Schema.optionalKey(IsoDateStringSchema),
  maxOrders: Schema.optionalKey(OrderPageSizeSchema),
  pageSize: Schema.optionalKey(OrderPageSizeSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  toDate: Schema.optionalKey(IsoDateStringSchema)
})

export type OrderItemsOperationInput = Schema.Schema.Type<typeof OrderItemsOperationInputSchema>

export const CartItemOperationInputSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ productId: NonEmptyTrimmedStringSchema, quantity: QuantitySchema })).check(
    Schema.isMinLength(1)
  )
})

export type CartItemOperationInput = Schema.Schema.Type<typeof CartItemOperationInputSchema>
