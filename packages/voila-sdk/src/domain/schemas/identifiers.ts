import { Schema } from "effect"

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)

/** A catalog search term that has crossed the SDK input boundary. */
export const QuerySchema = NonEmptyTrimmedStringSchema.pipe(Schema.brand("Query"))

export type Query = Schema.Schema.Type<typeof QuerySchema>

/** A Voila category identifier, distinct from a retailer category identifier. */
export const CategoryIdSchema = NonEmptyTrimmedStringSchema.pipe(Schema.brand("CategoryId"))

export type CategoryId = Schema.Schema.Type<typeof CategoryIdSchema>

/** The retailer's category identifier used by category and promotion endpoints. */
export const RetailerCategoryIdSchema = NonEmptyTrimmedStringSchema.pipe(Schema.brand("RetailerCategoryId"))

export type RetailerCategoryId = Schema.Schema.Type<typeof RetailerCategoryIdSchema>

/** An opaque cursor returned by a Voila pagination endpoint. */
export const PageTokenSchema = NonEmptyTrimmedStringSchema.pipe(Schema.brand("PageToken"))

export type PageToken = Schema.Schema.Type<typeof PageTokenSchema>

/** An opaque completed-order identifier accepted by order endpoints. */
export const OrderIdSchema = NonEmptyTrimmedStringSchema.pipe(Schema.brand("OrderId"))

export type OrderId = Schema.Schema.Type<typeof OrderIdSchema>

/** A calendar date in the wire format used by completed-order queries. */
export const IsoDateStringSchema = NonEmptyTrimmedStringSchema.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.brand("IsoDateString")
)

export type IsoDateString = Schema.Schema.Type<typeof IsoDateStringSchema>
