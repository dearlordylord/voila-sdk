import { Schema } from "effect"

import { MoneySchema, UnitPriceSchema } from "./money.js"

export const MIN_DISCOUNT_PAGE_SIZE = 1
export const MAX_DISCOUNT_PAGE_SIZE = 24
export const DEFAULT_DISCOUNT_PAGE_SIZE = 12
export const DEFAULT_MIN_SAVINGS_AMOUNT = 0.5
export const DEFAULT_MIN_SAVINGS_PERCENT = 10
export const MAX_DISCOUNT_QUERY_SCAN_PAGES = 5

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)

const DiscountPageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(MIN_DISCOUNT_PAGE_SIZE),
  Schema.lessThanOrEqualTo(MAX_DISCOUNT_PAGE_SIZE)
)

const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative()
)

export const DiscountSortSchema = Schema.Literal("best-percent", "best-amount", "price-asc")

export type DiscountSort = Schema.Schema.Type<typeof DiscountSortSchema>

export const DiscountedProductsInputSchema = Schema.Struct({
  categoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  minSavingsAmount: Schema.optionalWith(NonNegativeNumberSchema, { exact: true }),
  minSavingsPercent: Schema.optionalWith(NonNegativeNumberSchema, { exact: true }),
  pageSize: Schema.optionalWith(DiscountPageSizeSchema, { default: () => DEFAULT_DISCOUNT_PAGE_SIZE }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  query: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  retailerCategoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  sort: Schema.optionalWith(DiscountSortSchema, { exact: true })
})

export type DiscountedProductsInput = Schema.Schema.Type<typeof DiscountedProductsInputSchema>

export const RawPromotionMetadataSchema = Schema.Struct({
  description: Schema.optionalWith(Schema.String, { exact: true }),
  id: Schema.optionalWith(Schema.String, { exact: true }),
  label: Schema.optionalWith(Schema.String, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  promotionId: Schema.optionalWith(Schema.String, { exact: true }),
  type: Schema.optionalWith(Schema.String, { exact: true })
}).pipe(Schema.extend(UnknownStringRecordSchema))

export type RawPromotionMetadata = Schema.Schema.Type<typeof RawPromotionMetadataSchema>

export const RawPromotionProductSchema = Schema.Struct({
  available: Schema.Boolean,
  brand: Schema.optionalWith(Schema.String, { exact: true }),
  maxQuantityReached: Schema.Boolean,
  name: Schema.String,
  packSizeDescription: Schema.optionalWith(Schema.String, { exact: true }),
  price: MoneySchema,
  productId: Schema.String,
  promoPrice: Schema.optionalWith(MoneySchema, { exact: true }),
  promoUnitPrice: Schema.optionalWith(UnitPriceSchema, { exact: true }),
  promotions: Schema.optionalWith(Schema.Array(RawPromotionMetadataSchema), { exact: true }),
  quantityInBasket: Schema.Number,
  retailerProductId: Schema.String,
  unitPrice: Schema.optionalWith(UnitPriceSchema, { exact: true })
}).pipe(Schema.extend(UnknownStringRecordSchema))

export type RawPromotionProduct = Schema.Schema.Type<typeof RawPromotionProductSchema>

export const RawPromotionProductGroupSchema = Schema.Struct({
  decoratedProducts: Schema.optionalWith(Schema.Array(RawPromotionProductSchema), { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  products: Schema.optionalWith(Schema.Array(RawPromotionProductSchema), { exact: true }),
  type: Schema.String
}).pipe(Schema.extend(UnknownStringRecordSchema))

export type RawPromotionProductGroup = Schema.Schema.Type<typeof RawPromotionProductGroupSchema>

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.nonNegative()
)

export const PromotionProductsResponseSchema = Schema.Struct({
  nextPageToken: Schema.optionalWith(Schema.String, { exact: true }),
  productGroups: Schema.Array(RawPromotionProductGroupSchema),
  totalProducts: Schema.optionalWith(NonNegativeIntegerSchema, { exact: true })
}).pipe(Schema.extend(UnknownStringRecordSchema))

export type PromotionProductsResponse = Schema.Schema.Type<typeof PromotionProductsResponseSchema>
