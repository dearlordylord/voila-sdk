import { Schema } from "effect"

import { CategoryIdSchema, PageTokenSchema, RetailerCategoryIdSchema } from "./identifiers.js"
import { NormalizedSearchProductSchema, ProductSearchResponseSchema, SearchPaginationSchema } from "./product.js"

export const MIN_CATEGORY_PAGE_SIZE = 1
export const MAX_CATEGORY_PAGE_SIZE = 24

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)

const FilterSeparatorFreeStringSchema = NonEmptyTrimmedStringSchema.pipe(
  Schema.check(
    Schema.makeFilter((value) => !value.includes(":"), { message: "Category page filter values must not include ':'" })
  )
)

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

const CategoryPageSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_CATEGORY_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_CATEGORY_PAGE_SIZE))
)

export const CategoryPageFilterInputSchema = Schema.Struct({
  id: FilterSeparatorFreeStringSchema,
  value: FilterSeparatorFreeStringSchema
})

export type CategoryPageFilterInput = Schema.Schema.Type<typeof CategoryPageFilterInputSchema>

export const CategoryPageInputSchema = Schema.Struct({
  categoryId: Schema.optionalKey(CategoryIdSchema),
  filters: Schema.optionalKey(Schema.Array(CategoryPageFilterInputSchema)),
  pageSize: CategoryPageSizeSchema,
  pageToken: Schema.optionalKey(PageTokenSchema),
  retailerCategoryId: Schema.optionalKey(RetailerCategoryIdSchema)
}).pipe(
  Schema.check(
    Schema.makeFilter((input) => input.categoryId !== undefined || input.retailerCategoryId !== undefined, {
      message: "Category page input must include categoryId or retailerCategoryId"
    })
  )
)

export type CategoryPageInput = Schema.Schema.Type<typeof CategoryPageInputSchema>

export const CategoryPageSummarySchema = Schema.Struct({
  categoryId: NonEmptyTrimmedStringSchema,
  name: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  retailerCategoryId: NonEmptyTrimmedStringSchema,
  urlPath: Schema.optionalKey(NonEmptyTrimmedStringSchema)
})

export type CategoryPageSummary = Schema.Schema.Type<typeof CategoryPageSummarySchema>

export const CategoryPageFilterOptionSchema = Schema.Struct({
  count: Schema.optionalKey(NonNegativeIntegerSchema),
  id: NonEmptyTrimmedStringSchema,
  label: NonEmptyTrimmedStringSchema,
  selected: Schema.optionalKey(Schema.Boolean)
})

export type CategoryPageFilterOption = Schema.Schema.Type<typeof CategoryPageFilterOptionSchema>

export const CategoryPageFilterSchema = Schema.Struct({
  id: NonEmptyTrimmedStringSchema,
  label: NonEmptyTrimmedStringSchema,
  options: Schema.Array(CategoryPageFilterOptionSchema)
})

export type CategoryPageFilter = Schema.Schema.Type<typeof CategoryPageFilterSchema>

export const CategoryProductPageResponseSchema = ProductSearchResponseSchema.pipe(
  Schema.fieldsAssign({
    category: CategoryPageSummarySchema,
    filters: Schema.optionalKey(Schema.Array(CategoryPageFilterSchema))
  })
)

export type CategoryProductPageResponse = Schema.Schema.Type<typeof CategoryProductPageResponseSchema>

export const NormalizedCategoryProductsResultSchema = Schema.Struct({
  category: CategoryPageSummarySchema,
  filters: Schema.Array(CategoryPageFilterSchema),
  pagination: SearchPaginationSchema,
  products: Schema.Array(NormalizedSearchProductSchema)
})

export type NormalizedCategoryProductsResult = Schema.Schema.Type<typeof NormalizedCategoryProductsResultSchema>
