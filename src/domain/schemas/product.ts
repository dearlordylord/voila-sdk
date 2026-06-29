import { Schema } from "effect"

import { MoneySchema, UnitPriceSchema } from "./money.js"

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.nonNegative()
)

export const ProductImageSchema = Schema.Struct({
  description: Schema.optionalWith(Schema.String, { exact: true }),
  src: Schema.String
})

export type ProductImage = Schema.Schema.Type<typeof ProductImageSchema>

export const ProductSchema = Schema.Struct({
  available: Schema.Boolean,
  brand: Schema.optionalWith(Schema.String, { exact: true }),
  image: Schema.optionalWith(ProductImageSchema, { exact: true }),
  maxQuantityReached: Schema.Boolean,
  name: Schema.String,
  packSizeDescription: Schema.optionalWith(Schema.String, { exact: true }),
  price: MoneySchema,
  productId: Schema.String,
  quantityInBasket: Schema.Number,
  retailerProductId: Schema.String,
  unitPrice: Schema.optionalWith(UnitPriceSchema, { exact: true })
})

export type Product = Schema.Schema.Type<typeof ProductSchema>

export const ProductGroupSchema = Schema.Struct({
  decoratedProducts: Schema.optionalWith(Schema.Array(ProductSchema), { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  products: Schema.optionalWith(Schema.Array(ProductSchema), { exact: true }),
  type: Schema.String
})

export type ProductGroup = Schema.Schema.Type<typeof ProductGroupSchema>

export const ProductSearchResponseSchema = Schema.Struct({
  nextPageToken: Schema.optionalWith(Schema.String, { exact: true }),
  productGroups: Schema.Array(ProductGroupSchema),
  totalProducts: Schema.optionalWith(NonNegativeIntegerSchema, { exact: true })
})

export type ProductSearchResponse = Schema.Schema.Type<typeof ProductSearchResponseSchema>
