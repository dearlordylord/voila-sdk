import { Effect, Schema } from "effect"

import { MoneySchema, UnitPriceSchema } from "./money.js"

import { withUnknownStringFields } from "./unknown-fields.js"

export const MIN_DISCOUNT_PAGE_SIZE = 1
export const MAX_DISCOUNT_PAGE_SIZE = 24
export const DEFAULT_DISCOUNT_PAGE_SIZE = 12
export const DEFAULT_MIN_SAVINGS_AMOUNT = 0.5
export const DEFAULT_MIN_SAVINGS_PERCENT = 10
export const MAX_DISCOUNT_QUERY_SCAN_PAGES = 5

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)

const DiscountPageSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_DISCOUNT_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_DISCOUNT_PAGE_SIZE))
)

const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

export const DiscountSortSchema = Schema.Literals(["best-percent", "best-amount", "price-asc"])

export type DiscountSort = Schema.Schema.Type<typeof DiscountSortSchema>

export const DiscountedProductsInputSchema = Schema.Struct({
  categoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  minSavingsAmount: Schema.optionalKey(NonNegativeNumberSchema),
  minSavingsPercent: Schema.optionalKey(NonNegativeNumberSchema),
  pageSize: DiscountPageSizeSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_DISCOUNT_PAGE_SIZE))),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  query: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  retailerCategoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  sort: Schema.optionalKey(DiscountSortSchema)
})

export type DiscountedProductsInput = Schema.Schema.Type<typeof DiscountedProductsInputSchema>

export const RawPromotionMetadataSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  promotionId: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String)
}).pipe(withUnknownStringFields)

export type RawPromotionMetadata = Schema.Schema.Type<typeof RawPromotionMetadataSchema>

export const RawPromotionProductSchema = Schema.Struct({
  available: Schema.Boolean,
  brand: Schema.optionalKey(Schema.String),
  maxQuantityReached: Schema.Boolean,
  name: Schema.String,
  packSizeDescription: Schema.optionalKey(Schema.String),
  price: MoneySchema,
  productId: Schema.String,
  promoPrice: Schema.optionalKey(MoneySchema),
  promoUnitPrice: Schema.optionalKey(UnitPriceSchema),
  promotions: Schema.optionalKey(Schema.Array(RawPromotionMetadataSchema)),
  quantityInBasket: Schema.Number,
  retailerProductId: Schema.String,
  unitPrice: Schema.optionalKey(UnitPriceSchema)
}).pipe(withUnknownStringFields)

export type RawPromotionProduct = Schema.Schema.Type<typeof RawPromotionProductSchema>

export const RawPromotionProductGroupSchema = Schema.Struct({
  decoratedProducts: Schema.optionalKey(Schema.Array(RawPromotionProductSchema)),
  name: Schema.optionalKey(Schema.String),
  products: Schema.optionalKey(Schema.Array(RawPromotionProductSchema)),
  type: Schema.String
}).pipe(withUnknownStringFields)

export type RawPromotionProductGroup = Schema.Schema.Type<typeof RawPromotionProductGroupSchema>

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

export const PromotionProductsResponseSchema = Schema.Struct({
  nextPageToken: Schema.optionalKey(Schema.String),
  productGroups: Schema.Array(RawPromotionProductGroupSchema),
  totalProducts: Schema.optionalKey(NonNegativeIntegerSchema)
}).pipe(withUnknownStringFields)

export type PromotionProductsResponse = Schema.Schema.Type<typeof PromotionProductsResponseSchema>
