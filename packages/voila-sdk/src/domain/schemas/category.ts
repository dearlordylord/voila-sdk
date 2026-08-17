import { Schema } from "effect"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))

const RootedUrlPathSchema = NonEmptyTrimmedStringSchema.pipe(Schema.startsWith("/"))

const normalizedUrlPath = (path: string): boolean => !path.startsWith("//")

const distinctCategoryIdentifiers = (category: {
  readonly categoryId: string
  readonly retailerCategoryId: string
}): boolean => category.categoryId !== category.retailerCategoryId

/**
 * The page publishes its categories as a normalized store: entries keyed by
 * category ID, children named by ID, and the top level listed in `root`. Each
 * entry already carries its full path, so the tree is a lookup rather than a
 * concatenation.
 */
export const RawCategoryEntrySchema = Schema.Struct({
  children: Schema.Array(NonEmptyTrimmedStringSchema),
  fullURLPath: NonEmptyTrimmedStringSchema,
  id: NonEmptyTrimmedStringSchema,
  name: NonEmptyTrimmedStringSchema,
  retailerId: NonEmptyTrimmedStringSchema
}).pipe(
  Schema.filter((entry) => entry.id !== entry.retailerId, {
    message: () => "Category ID and retailer category ID must be distinct"
  })
)

export const RawCategoryStoreSchema = Schema.Struct({
  categories: Schema.Record({ key: NonEmptyTrimmedStringSchema, value: RawCategoryEntrySchema }),
  root: Schema.Array(NonEmptyTrimmedStringSchema)
})

export type RawCategoryEntry = Schema.Schema.Type<typeof RawCategoryEntrySchema>

export type RawCategoryStore = Schema.Schema.Type<typeof RawCategoryStoreSchema>

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
  Schema.filter(distinctCategoryIdentifiers, { message: () => "Category ID and retailer category ID must be distinct" })
)

export const NormalizedCategoryTreeSchema = Schema.Array(NormalizedCategorySchema)

export type NormalizedCategory = Schema.Schema.Type<typeof NormalizedCategorySchema>

export type NormalizedCategoryTree = Schema.Schema.Type<typeof NormalizedCategoryTreeSchema>
