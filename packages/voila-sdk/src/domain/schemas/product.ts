import { Schema } from "effect"

import { MoneySchema, UnitPriceSchema } from "./money.js"
import { ProductUuidSchema } from "./cart.js"
import { PageTokenSchema } from "./identifiers.js"

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)

export const ProductImageSchema = Schema.Struct({ description: Schema.optionalKey(Schema.String), src: Schema.String })

export type ProductImage = Schema.Schema.Type<typeof ProductImageSchema>

export const ProductSchema = Schema.Struct({
  available: Schema.Boolean,
  brand: Schema.optionalKey(Schema.String),
  image: Schema.optionalKey(ProductImageSchema),
  maxQuantityReached: Schema.Boolean,
  name: Schema.String,
  packSizeDescription: Schema.optionalKey(Schema.String),
  price: MoneySchema,
  productId: Schema.String,
  quantityInBasket: Schema.Number,
  retailerProductId: Schema.String,
  unitPrice: Schema.optionalKey(UnitPriceSchema)
})

export type Product = Schema.Schema.Type<typeof ProductSchema>

/** A product that has crossed the SDK normalization boundary. */
export const NormalizedProductSchema = ProductSchema.pipe(Schema.fieldsAssign({ productId: ProductUuidSchema }))

export type NormalizedProduct = Schema.Schema.Type<typeof NormalizedProductSchema>

export const ProductGroupSchema = Schema.Struct({
  decoratedProducts: Schema.optionalKey(Schema.Array(ProductSchema)),
  name: Schema.optionalKey(Schema.String),
  products: Schema.optionalKey(Schema.Array(ProductSchema)),
  type: Schema.String
})

export type ProductGroup = Schema.Schema.Type<typeof ProductGroupSchema>

export const NormalizedProductGroupSchema = Schema.Struct({
  decoratedProducts: Schema.optionalKey(Schema.Array(NormalizedProductSchema)),
  name: Schema.optionalKey(Schema.String),
  products: Schema.optionalKey(Schema.Array(NormalizedProductSchema)),
  type: Schema.String
})

export type NormalizedProductGroup = Schema.Schema.Type<typeof NormalizedProductGroupSchema>

export const NormalizedSearchProductSchema = NormalizedProductSchema.pipe(
  Schema.fieldsAssign({ sourceGroupName: Schema.optionalKey(Schema.String), sourceGroupType: Schema.String })
)

export type NormalizedSearchProduct = Schema.Schema.Type<typeof NormalizedSearchProductSchema>

export const SearchPaginationSchema = Schema.Struct({
  nextPageToken: Schema.optionalKey(PageTokenSchema),
  totalProducts: Schema.optionalKey(NonNegativeIntegerSchema)
})

export type SearchPagination = Schema.Schema.Type<typeof SearchPaginationSchema>

export const NormalizedSearchResultSchema = Schema.Struct({
  pagination: SearchPaginationSchema,
  products: Schema.Array(NormalizedSearchProductSchema)
})

export type NormalizedSearchResult = Schema.Schema.Type<typeof NormalizedSearchResultSchema>

export const ProductSearchResponseSchema = Schema.Struct({
  nextPageToken: Schema.optionalKey(Schema.String),
  productGroups: Schema.Array(ProductGroupSchema),
  totalProducts: Schema.optionalKey(NonNegativeIntegerSchema)
})

export type ProductSearchResponse = Schema.Schema.Type<typeof ProductSearchResponseSchema>
