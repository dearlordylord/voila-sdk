import { Effect, Schema } from "effect"

import { MoneySchema, UnitPriceSchema } from "./money.js"

import { CategoryIdSchema, PageTokenSchema, QuerySchema, RetailerCategoryIdSchema } from "./identifiers.js"
import { ProductUuidSchema } from "./cart.js"

import { withUnknownStringFields } from "./unknown-fields.js"

export const MIN_DISCOUNT_PAGE_SIZE = 1
export const MAX_DISCOUNT_PAGE_SIZE = 24
export const MAX_DISCOUNT_QUERY_SCAN_PAGES = 5
const defaultDiscountPageSizeValue = 12
const defaultMinSavingsAmountValue = 0.5
const defaultMinSavingsPercentValue = 10

export const DiscountPageSizeSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_DISCOUNT_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_DISCOUNT_PAGE_SIZE))
).pipe(Schema.brand("DiscountPageSize"))

export type DiscountPageSize = Schema.Schema.Type<typeof DiscountPageSizeSchema>

const SafeNonNegativeDiscountNumberSchema = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
)

export const DiscountSavingsAmountSchema = SafeNonNegativeDiscountNumberSchema.pipe(
  Schema.brand("DiscountSavingsAmount")
)

export type DiscountSavingsAmount = Schema.Schema.Type<typeof DiscountSavingsAmountSchema>

export const DiscountSavingsPercentSchema = SafeNonNegativeDiscountNumberSchema.pipe(
  Schema.brand("DiscountSavingsPercent")
)

export type DiscountSavingsPercent = Schema.Schema.Type<typeof DiscountSavingsPercentSchema>

export const DEFAULT_DISCOUNT_PAGE_SIZE = DiscountPageSizeSchema.make(defaultDiscountPageSizeValue)
export const DEFAULT_MIN_SAVINGS_AMOUNT = DiscountSavingsAmountSchema.make(defaultMinSavingsAmountValue)
export const DEFAULT_MIN_SAVINGS_PERCENT = DiscountSavingsPercentSchema.make(defaultMinSavingsPercentValue)

export const DiscountSortSchema = Schema.Literals(["best-percent", "best-amount", "price-asc"])

export type DiscountSort = Schema.Schema.Type<typeof DiscountSortSchema>

export const DiscountedProductsInputSchema = Schema.Struct({
  categoryId: Schema.optionalKey(CategoryIdSchema),
  minSavingsAmount: Schema.optionalKey(DiscountSavingsAmountSchema),
  minSavingsPercent: Schema.optionalKey(DiscountSavingsPercentSchema),
  pageSize: DiscountPageSizeSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_DISCOUNT_PAGE_SIZE))),
  pageToken: Schema.optionalKey(PageTokenSchema),
  query: Schema.optionalKey(QuerySchema),
  retailerCategoryId: Schema.optionalKey(RetailerCategoryIdSchema),
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

const NonNegativeDiscountNumberSchema = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

export const NormalizedDiscountProductSchema = Schema.Struct({
  available: Schema.Boolean,
  brand: Schema.optionalKey(Schema.String),
  discountPrice: MoneySchema,
  name: Schema.String,
  packSizeDescription: Schema.optionalKey(Schema.String),
  productId: ProductUuidSchema,
  promoUnitPrice: Schema.optionalKey(UnitPriceSchema),
  promotionSummary: Schema.optionalKey(Schema.String),
  promotions: Schema.Array(RawPromotionMetadataSchema),
  regularPrice: MoneySchema,
  retailerProductId: Schema.String,
  savingsAmount: NonNegativeDiscountNumberSchema,
  savingsPercent: NonNegativeDiscountNumberSchema,
  savingsPrice: MoneySchema,
  sourceGroupName: Schema.optionalKey(Schema.String),
  sourceGroupType: Schema.String,
  unitPrice: Schema.optionalKey(UnitPriceSchema)
})

export type NormalizedDiscountProduct = Schema.Schema.Type<typeof NormalizedDiscountProductSchema>

const DiscountScanMetadataFields = {
  matchedProducts: NonNegativeIntegerSchema,
  maxPages: NonNegativeIntegerSchema,
  pagesScanned: NonNegativeIntegerSchema,
  requestedPageSize: DiscountPageSizeSchema,
  returnedProducts: NonNegativeIntegerSchema,
  startedPageToken: Schema.optionalKey(PageTokenSchema)
}

/**
 * A scan either reached the end of the endpoint or has a cursor that can be
 * used to continue it. Keeping those states tagged makes an exhausted scan
 * with a cursor (and a partial scan without one) unrepresentable.
 */
export const DiscountScanMetadataSchema = Schema.TaggedUnion({
  exhausted: DiscountScanMetadataFields,
  continuable: { ...DiscountScanMetadataFields, nextPageToken: PageTokenSchema }
})

export type DiscountScanMetadata = Schema.Schema.Type<typeof DiscountScanMetadataSchema>

export const DiscountedProductsPaginationSchema = Schema.Struct({
  nextPageToken: Schema.optionalKey(PageTokenSchema),
  totalProducts: Schema.optionalKey(NonNegativeIntegerSchema)
})

export type DiscountedProductsPagination = Schema.Schema.Type<typeof DiscountedProductsPaginationSchema>

export const NormalizedDiscountedProductsResultSchema = Schema.Struct({
  pagination: DiscountedProductsPaginationSchema,
  products: Schema.Array(NormalizedDiscountProductSchema),
  scan: DiscountScanMetadataSchema
})

export type NormalizedDiscountedProductsResult = Schema.Schema.Type<typeof NormalizedDiscountedProductsResultSchema>
