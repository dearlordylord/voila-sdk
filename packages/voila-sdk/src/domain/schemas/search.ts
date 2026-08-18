import { Schema } from "effect"

export const MIN_SEARCH_PAGE_SIZE = 1
export const MAX_SEARCH_PAGE_SIZE = 24

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)

const SearchPageSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_SEARCH_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_SEARCH_PAGE_SIZE))
)

export const SearchCategoryContextSchema = Schema.Struct({
  categoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  retailerCategoryId: Schema.optionalKey(NonEmptyTrimmedStringSchema)
}).pipe(
  Schema.check(
    Schema.makeFilter((context) => context.categoryId !== undefined || context.retailerCategoryId !== undefined, {
      message: "Category context must include categoryId or retailerCategoryId"
    })
  )
)

export type SearchCategoryContext = Schema.Schema.Type<typeof SearchCategoryContextSchema>

export const SearchInputSchema = Schema.Struct({
  categoryContext: Schema.optionalKey(SearchCategoryContextSchema),
  pageSize: SearchPageSizeSchema,
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  query: NonEmptyTrimmedStringSchema
})

export type SearchInput = Schema.Schema.Type<typeof SearchInputSchema>
