import { Schema } from "effect"

import { CategoryIdSchema, PageTokenSchema, QuerySchema, RetailerCategoryIdSchema } from "./identifiers.js"

export const MIN_SEARCH_PAGE_SIZE = 1
export const MAX_SEARCH_PAGE_SIZE = 24

const SearchPageSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_SEARCH_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_SEARCH_PAGE_SIZE))
)

export const SearchCategoryContextSchema = Schema.Struct({
  categoryId: Schema.optionalKey(CategoryIdSchema),
  retailerCategoryId: Schema.optionalKey(RetailerCategoryIdSchema)
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
  pageToken: Schema.optionalKey(PageTokenSchema),
  query: QuerySchema
})

export type SearchInput = Schema.Schema.Type<typeof SearchInputSchema>
