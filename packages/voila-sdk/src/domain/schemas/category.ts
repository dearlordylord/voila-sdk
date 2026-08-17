import { Schema } from "effect"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(Schema.trimmed(), Schema.minLength(1))

const RootedUrlPathSchema = NonEmptyTrimmedStringSchema.pipe(Schema.startsWith("/"))

const normalizedUrlPath = (path: string): boolean => !path.startsWith("//")

const distinctCategoryIdentifiers = (category: {
  readonly categoryId: string
  readonly retailerCategoryId: string
}): boolean => category.categoryId !== category.retailerCategoryId

/**
 * Voila publishes its homepage categories in two shapes, and which one a
 * session is served is not something the SDK can predict: the older nested
 * shape may still reach an A/B bucket or a region, or may already be
 * deprecated mid-rollout — from here those look the same. Both are decoded,
 * and both resolve to the same normalized tree.
 *
 * The nested shape spells the tree out inline, each category carrying a path
 * segment its children extend.
 */
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
  Schema.filter(distinctCategoryIdentifiers, { message: () => "Category ID and retailer category ID must be distinct" })
)

export const RawCategoryTreeSchema = Schema.Array(RawCategorySchema)

export type RawCategory = Schema.Schema.Type<typeof RawCategorySchema>

export type RawCategoryTree = Schema.Schema.Type<typeof RawCategoryTreeSchema>

/**
 * The store shape keys entries by category ID, names children by ID, and lists
 * the top level in `root`. Each entry already carries its full path, so the
 * tree is a lookup rather than a concatenation.
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

export const RawCategoriesSchema = Schema.Union(RawCategoryStoreSchema, RawCategoryTreeSchema)

export type RawCategories = Schema.Schema.Type<typeof RawCategoriesSchema>

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
