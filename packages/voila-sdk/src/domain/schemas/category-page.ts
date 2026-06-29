import { Schema } from "effect"

import { ProductSearchResponseSchema } from "./product.js"

export const MIN_CATEGORY_PAGE_SIZE = 1
export const MAX_CATEGORY_PAGE_SIZE = 24

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)

const FilterSeparatorFreeStringSchema = NonEmptyTrimmedStringSchema.pipe(
  Schema.filter((value) => !value.includes(":"), {
    message: () => "Category page filter values must not include ':'"
  })
)

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.nonNegative()
)

const CategoryPageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(MIN_CATEGORY_PAGE_SIZE),
  Schema.lessThanOrEqualTo(MAX_CATEGORY_PAGE_SIZE)
)

export const CategoryPageFilterInputSchema = Schema.Struct({
  id: FilterSeparatorFreeStringSchema,
  value: FilterSeparatorFreeStringSchema
})

export type CategoryPageFilterInput = Schema.Schema.Type<typeof CategoryPageFilterInputSchema>

export const CategoryPageInputSchema = Schema.Struct({
  categoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  filters: Schema.optionalWith(Schema.Array(CategoryPageFilterInputSchema), { exact: true }),
  pageSize: CategoryPageSizeSchema,
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  retailerCategoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
}).pipe(
  Schema.filter(
    (input) => input.categoryId !== undefined || input.retailerCategoryId !== undefined,
    { message: () => "Category page input must include categoryId or retailerCategoryId" }
  )
)

export type CategoryPageInput = Schema.Schema.Type<typeof CategoryPageInputSchema>

export const CategoryPageSummarySchema = Schema.Struct({
  categoryId: NonEmptyTrimmedStringSchema,
  name: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  retailerCategoryId: NonEmptyTrimmedStringSchema,
  urlPath: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type CategoryPageSummary = Schema.Schema.Type<typeof CategoryPageSummarySchema>

export const CategoryPageFilterOptionSchema = Schema.Struct({
  count: Schema.optionalWith(NonNegativeIntegerSchema, { exact: true }),
  id: NonEmptyTrimmedStringSchema,
  label: NonEmptyTrimmedStringSchema,
  selected: Schema.optionalWith(Schema.Boolean, { exact: true })
})

export type CategoryPageFilterOption = Schema.Schema.Type<typeof CategoryPageFilterOptionSchema>

export const CategoryPageFilterSchema = Schema.Struct({
  id: NonEmptyTrimmedStringSchema,
  label: NonEmptyTrimmedStringSchema,
  options: Schema.Array(CategoryPageFilterOptionSchema)
})

export type CategoryPageFilter = Schema.Schema.Type<typeof CategoryPageFilterSchema>

export const CategoryProductPageResponseSchema = ProductSearchResponseSchema.pipe(
  Schema.extend(Schema.Struct({
    category: CategoryPageSummarySchema,
    filters: Schema.optionalWith(Schema.Array(CategoryPageFilterSchema), { exact: true })
  }))
)

export type CategoryProductPageResponse = Schema.Schema.Type<typeof CategoryProductPageResponseSchema>
