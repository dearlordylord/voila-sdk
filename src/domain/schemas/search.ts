import { Schema } from "effect"

export const MIN_SEARCH_PAGE_SIZE = 1
export const MAX_SEARCH_PAGE_SIZE = 24

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)

const SearchPageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(MIN_SEARCH_PAGE_SIZE),
  Schema.lessThanOrEqualTo(MAX_SEARCH_PAGE_SIZE)
)

export const SearchCategoryContextSchema = Schema.Struct({
  categoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  retailerCategoryId: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
}).pipe(
  Schema.filter(
    (context) => context.categoryId !== undefined || context.retailerCategoryId !== undefined,
    { message: () => "Category context must include categoryId or retailerCategoryId" }
  )
)

export type SearchCategoryContext = Schema.Schema.Type<typeof SearchCategoryContextSchema>

export const SearchInputSchema = Schema.Struct({
  categoryContext: Schema.optionalWith(SearchCategoryContextSchema, { exact: true }),
  pageSize: SearchPageSizeSchema,
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  query: NonEmptyTrimmedStringSchema
})

export type SearchInput = Schema.Schema.Type<typeof SearchInputSchema>
