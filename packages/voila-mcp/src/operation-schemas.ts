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

export const EmptyOperationInputSchema = Schema.Struct({})

export type EmptyOperationInput = Schema.Schema.Type<typeof EmptyOperationInputSchema>

export const ProductListOperationInputSchema = Schema.Struct({
  pageSize: Schema.optionalWith(PageSizeSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  query: NonEmptyTrimmedStringSchema
})

export type ProductListOperationInput = Schema.Schema.Type<typeof ProductListOperationInputSchema>

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
