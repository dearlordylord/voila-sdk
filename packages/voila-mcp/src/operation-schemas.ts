import {
  CategoryIdSchema,
  DiscountPageSizeSchema,
  DiscountSavingsAmountSchema,
  DiscountSavingsPercentSchema,
  IsoDateStringSchema,
  OrderIdSchema,
  PageTokenSchema,
  ProductUuidSchema,
  QuerySchema,
  RetailerCategoryIdSchema
} from "@firfi/voila-sdk"
import { Schema } from "effect"

import { maximumOrderPageSize, maximumProductPageSize } from "./operation-limits.js"

const NonEmptyTrimmedStringSchema = Schema.Trimmed.check(Schema.isNonEmpty())
const defaultProductPageSizeValue = 12

export const ProductPageSizeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumProductPageSize)
).pipe(Schema.brand("ProductPageSize"))

export type ProductPageSize = Schema.Schema.Type<typeof ProductPageSizeSchema>

export const DEFAULT_PRODUCT_PAGE_SIZE = ProductPageSizeSchema.make(defaultProductPageSizeValue)

const PositiveIntegerSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

export const OrderPageSizeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumOrderPageSize)
).pipe(Schema.brand("OrderPageSize"))

export type OrderPageSize = Schema.Schema.Type<typeof OrderPageSizeSchema>

export const MaxOrdersSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(maximumOrderPageSize)
).pipe(Schema.brand("MaxOrders"))

export type MaxOrders = Schema.Schema.Type<typeof MaxOrdersSchema>

export const CartQuantitySchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)).pipe(
  Schema.brand("CartQuantity")
)

export type CartQuantity = Schema.Schema.Type<typeof CartQuantitySchema>

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
  pageSize: Schema.optionalKey(ProductPageSizeSchema),
  pageToken: Schema.optionalKey(PageTokenSchema),
  query: QuerySchema
})

export type ProductListOperationInput = Schema.Schema.Type<typeof ProductListOperationInputSchema>

export const DiscountSortOperationInputSchema = Schema.Literals(["best-percent", "best-amount", "price-asc"])

export const DiscountedProductsOperationInputSchema = Schema.Struct({
  categoryId: Schema.optionalKey(CategoryIdSchema),
  minSavingsAmount: Schema.optionalKey(DiscountSavingsAmountSchema),
  minSavingsPercent: Schema.optionalKey(DiscountSavingsPercentSchema),
  pageSize: Schema.optionalKey(DiscountPageSizeSchema),
  pageToken: Schema.optionalKey(PageTokenSchema),
  query: Schema.optionalKey(QuerySchema),
  retailerCategoryId: Schema.optionalKey(RetailerCategoryIdSchema),
  sort: Schema.optionalKey(DiscountSortOperationInputSchema)
})

export type DiscountedProductsOperationInput = Schema.Schema.Type<typeof DiscountedProductsOperationInputSchema>

export const CategoryProductsOperationInputSchema = Schema.Struct({
  categoryId: CategoryIdSchema,
  pageSize: Schema.optionalKey(ProductPageSizeSchema),
  pageToken: Schema.optionalKey(PageTokenSchema)
})

export type CategoryProductsOperationInput = Schema.Schema.Type<typeof CategoryProductsOperationInputSchema>

export const OrderListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalKey(OrderPageSizeSchema),
  pageToken: Schema.optionalKey(PageTokenSchema)
})

export type OrderListOperationInput = Schema.Schema.Type<typeof OrderListOperationInputSchema>

export const OrderDetailsOperationInputSchema = Schema.Struct({ orderId: OrderIdSchema })

export type OrderDetailsOperationInput = Schema.Schema.Type<typeof OrderDetailsOperationInputSchema>

export const OrderItemsOperationInputSchema = Schema.Struct({
  fromDate: Schema.optionalKey(IsoDateStringSchema),
  maxOrders: Schema.optionalKey(MaxOrdersSchema),
  pageSize: Schema.optionalKey(OrderPageSizeSchema),
  pageToken: Schema.optionalKey(PageTokenSchema),
  toDate: Schema.optionalKey(IsoDateStringSchema)
})

export type OrderItemsOperationInput = Schema.Schema.Type<typeof OrderItemsOperationInputSchema>

export const CartItemOperationInputSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ productId: ProductUuidSchema, quantity: CartQuantitySchema })).check(
    Schema.isMinLength(1)
  )
})

export type CartItemOperationInput = Schema.Schema.Type<typeof CartItemOperationInputSchema>
