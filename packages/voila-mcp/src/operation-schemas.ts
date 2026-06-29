import { Schema } from "effect"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)
const IsoDateStringSchema = NonEmptyTrimmedStringSchema.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)
)

const PageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(24)
)

const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative()
)

const PositiveIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.positive()
)

const OrderPageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(50)
)

const QuantitySchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThan(0)
)

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

export const EmptyOperationInputSchema = Schema.Struct({})

export type EmptyOperationInput = Schema.Schema.Type<typeof EmptyOperationInputSchema>

export const ActiveShoppingContextOperationInputSchema = Schema.Struct({
  regionId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type ActiveShoppingContextOperationInput = Schema.Schema.Type<
  typeof ActiveShoppingContextOperationInputSchema
>

export const SlotDisplayConfigurationOperationInputSchema = Schema.Literal("DELIVERY_METHOD", "CARRIER")

export const SlotListingsOperationInputSchema = Schema.Struct({
  deliveryDestinationId: NonEmptyTrimmedStringSchema,
  displayConfiguration: Schema.optionalWith(SlotDisplayConfigurationOperationInputSchema, { exact: true }),
  numberOfDays: Schema.optionalWith(PositiveIntegerSchema, { exact: true }),
  regionId: NonEmptyTrimmedStringSchema,
  shippingGroupType: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  viewingLocation: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type SlotListingsOperationInput = Schema.Schema.Type<typeof SlotListingsOperationInputSchema>

export const SlotReservationOperationInputSchema = Schema.Struct({
  allowReservationOverwrite: Schema.Literal(true),
  confirmSlotReservation: Schema.Literal(true),
  deliveryDestinationId: NonEmptyTrimmedStringSchema,
  externalAddress: Schema.optionalWith(UnknownStringRecordSchema, { exact: true }),
  regionId: NonEmptyTrimmedStringSchema,
  slotId: NonEmptyTrimmedStringSchema
})

export type SlotReservationOperationInput = Schema.Schema.Type<typeof SlotReservationOperationInputSchema>

export const ProductListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalWith(PageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  query: NonEmptyTrimmedStringSchema
})

export type ProductListOperationInput = Schema.Schema.Type<typeof ProductListOperationInputSchema>

export const DiscountSortOperationInputSchema = Schema.Literal("best-percent", "best-amount", "price-asc")

export const DiscountedProductsOperationInputSchema = Schema.Struct({
  categoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  minSavingsAmount: Schema.optionalWith(NonNegativeNumberSchema, { exact: true }),
  minSavingsPercent: Schema.optionalWith(NonNegativeNumberSchema, { exact: true }),
  pageSize: Schema.optionalWith(PageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  query: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  retailerCategoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  sort: Schema.optionalWith(DiscountSortOperationInputSchema, { exact: true })
})

export type DiscountedProductsOperationInput = Schema.Schema.Type<typeof DiscountedProductsOperationInputSchema>

export const CategoryProductsOperationInputSchema = Schema.Struct({
  categoryId: NonEmptyTrimmedStringSchema,
  pageSize: Schema.optionalWith(PageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type CategoryProductsOperationInput = Schema.Schema.Type<typeof CategoryProductsOperationInputSchema>

export const OrderListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalWith(OrderPageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type OrderListOperationInput = Schema.Schema.Type<typeof OrderListOperationInputSchema>

export const OrderDetailsOperationInputSchema = Schema.Struct({
  orderId: NonEmptyTrimmedStringSchema
})

export type OrderDetailsOperationInput = Schema.Schema.Type<typeof OrderDetailsOperationInputSchema>

export const OrderItemsOperationInputSchema = Schema.Struct({
  fromDate: Schema.optionalWith(IsoDateStringSchema, { exact: true }),
  maxOrders: Schema.optionalWith(OrderPageSizeSchema, { exact: true }),
  pageSize: Schema.optionalWith(OrderPageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  toDate: Schema.optionalWith(IsoDateStringSchema, { exact: true })
})

export type OrderItemsOperationInput = Schema.Schema.Type<typeof OrderItemsOperationInputSchema>

export const CartItemOperationInputSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    productId: NonEmptyTrimmedStringSchema,
    quantity: QuantitySchema
  })).pipe(Schema.minItems(1))
})

export type CartItemOperationInput = Schema.Schema.Type<typeof CartItemOperationInputSchema>
