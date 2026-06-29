import { Schema } from "effect"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)

const RootedUrlPathSchema = NonEmptyTrimmedStringSchema.pipe(Schema.startsWith("/"))

const normalizedUrlPath = (path: string): boolean => !path.startsWith("//")

const distinctCategoryIdentifiers = (category: {
  readonly categoryId: string
  readonly retailerCategoryId: string
}): boolean => category.categoryId !== category.retailerCategoryId

interface RawCategoryShape {
  readonly categories?: ReadonlyArray<RawCategory>
  readonly categoryId: string
  readonly name: string
  readonly retailerCategoryId: string
  readonly urlPath: string
}

export const RawCategorySchema: Schema.Schema<RawCategoryShape> = Schema.Struct({
  categories: Schema.optionalWith(Schema.Array(Schema.suspend((): Schema.Schema<RawCategory> => RawCategorySchema)), {
    exact: true
  }),
  categoryId: NonEmptyTrimmedStringSchema,
  name: NonEmptyTrimmedStringSchema,
  retailerCategoryId: NonEmptyTrimmedStringSchema,
  urlPath: NonEmptyTrimmedStringSchema
}).pipe(
  Schema.filter(distinctCategoryIdentifiers, {
    message: () => "Category ID and retailer category ID must be distinct"
  })
)

export const RawCategoryTreeSchema = Schema.Array(RawCategorySchema)

export type RawCategory = Schema.Schema.Type<typeof RawCategorySchema>

export type RawCategoryTree = Schema.Schema.Type<typeof RawCategoryTreeSchema>

interface NormalizedCategoryShape {
  readonly categoryId: string
  readonly children: ReadonlyArray<NormalizedCategory>
  readonly fullUrlPath: string
  readonly name: string
  readonly retailerCategoryId: string
}

export const NormalizedCategorySchema: Schema.Schema<NormalizedCategoryShape> = Schema.Struct({
  categoryId: NonEmptyTrimmedStringSchema,
  children: Schema.Array(Schema.suspend((): Schema.Schema<NormalizedCategory> => NormalizedCategorySchema)),
  fullUrlPath: RootedUrlPathSchema,
  name: NonEmptyTrimmedStringSchema,
  retailerCategoryId: NonEmptyTrimmedStringSchema
}).pipe(
  Schema.filter((category) => normalizedUrlPath(category.fullUrlPath), {
    message: () => "Category full URL path must not start with duplicate slashes"
  }),
  Schema.filter(distinctCategoryIdentifiers, {
    message: () => "Category ID and retailer category ID must be distinct"
  })
)

export const NormalizedCategoryTreeSchema = Schema.Array(NormalizedCategorySchema)

export type NormalizedCategory = Schema.Schema.Type<typeof NormalizedCategorySchema>

export type NormalizedCategoryTree = Schema.Schema.Type<typeof NormalizedCategoryTreeSchema>
