import { Effect, Schema } from "effect"

import { MoneySchema } from "./money.js"

import { PageTokenSchema } from "./identifiers.js"

import { withUnknownStringFields } from "./unknown-fields.js"

export const MIN_ORDER_PAGE_SIZE = 1
export const MAX_ORDER_PAGE_SIZE = 50
export const DEFAULT_ORDER_PAGE_SIZE = 20

const OrderPageSizeSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(MIN_ORDER_PAGE_SIZE)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_ORDER_PAGE_SIZE))
)

export const CompletedOrdersInputSchema = Schema.Struct({
  pageSize: OrderPageSizeSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_ORDER_PAGE_SIZE))),
  pageToken: Schema.optionalKey(PageTokenSchema)
})

export type CompletedOrdersInput = Schema.Schema.Type<typeof CompletedOrdersInputSchema>

const RawOrderRegionSchema = Schema.revealCodec(
  Schema.Struct({ regionId: Schema.String, retailerRegionId: Schema.String }).pipe(withUnknownStringFields)
)

const RawOrderCarrierSchema = Schema.revealCodec(
  Schema.Struct({ carrierId: Schema.String }).pipe(withUnknownStringFields)
)

const RawOrderExternalLockerSchema = Schema.revealCodec(
  Schema.Struct({ externalLockerId: Schema.String }).pipe(withUnknownStringFields)
)

const RawOrderDeliveryDestinationSchema = Schema.revealCodec(
  Schema.Struct({
    address: Schema.Struct({ timeZone: Schema.String }).pipe(withUnknownStringFields),
    deliveryMethod: Schema.String,
    name: Schema.String
  }).pipe(withUnknownStringFields)
)

export const RawCompletedOrdersGraphqlErrorSchema = Schema.revealCodec(
  Schema.Struct({ message: Schema.String }).pipe(withUnknownStringFields)
)

export type RawCompletedOrdersGraphqlError = Schema.Schema.Type<typeof RawCompletedOrdersGraphqlErrorSchema>

export const RawInternalCompletedOrderSlotSchema = Schema.revealCodec(
  Schema.Struct({
    __typename: Schema.Literal("InternalOrderSlot"),
    carrier: Schema.optionalKey(Schema.NullOr(RawOrderCarrierSchema)),
    deliveryDestination: RawOrderDeliveryDestinationSchema,
    end: Schema.String,
    externalLocker: Schema.optionalKey(Schema.NullOr(RawOrderExternalLockerSchema)),
    shippingGroupType: Schema.optionalKey(Schema.String),
    start: Schema.String,
    type: Schema.String
  }).pipe(withUnknownStringFields)
)

export type RawInternalCompletedOrderSlot = Schema.Schema.Type<typeof RawInternalCompletedOrderSlotSchema>

export const RawImportedCompletedOrderSlotSchema = Schema.revealCodec(
  Schema.Struct({
    __typename: Schema.Literal("ImportedOrderSlot"),
    end: Schema.String,
    name: Schema.String,
    start: Schema.String,
    timeZone: Schema.String
  }).pipe(withUnknownStringFields)
)

export type RawImportedCompletedOrderSlot = Schema.Schema.Type<typeof RawImportedCompletedOrderSlotSchema>

export const RawCompletedOrderSlotSchema = Schema.Union([
  RawInternalCompletedOrderSlotSchema,
  RawImportedCompletedOrderSlotSchema
])

export type RawCompletedOrderSlot = Schema.Schema.Type<typeof RawCompletedOrderSlotSchema>

export const RawCompletedOrderNodeSchema = Schema.revealCodec(
  Schema.Struct({
    orderId: Schema.String,
    prices: Schema.Struct({ total: MoneySchema }).pipe(withUnknownStringFields),
    recurringOrderDefinition: Schema.optionalKey(
      Schema.NullOr(Schema.Struct({ name: Schema.String }).pipe(withUnknownStringFields))
    ),
    region: RawOrderRegionSchema,
    slot: RawCompletedOrderSlotSchema,
    status: Schema.String
  }).pipe(withUnknownStringFields)
)

export type RawCompletedOrderNode = Schema.Schema.Type<typeof RawCompletedOrderNodeSchema>

const RawCompletedOrdersConnectionSchema = Schema.revealCodec(
  Schema.Struct({
    edges: Schema.Array(
      Schema.NullOr(Schema.Struct({ node: Schema.NullOr(RawCompletedOrderNodeSchema) }).pipe(withUnknownStringFields))
    ),
    pageInfo: Schema.Struct({ endCursor: Schema.NullOr(Schema.String), hasNextPage: Schema.Boolean }).pipe(
      withUnknownStringFields
    ),
    retentionPeriod: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawCompletedOrdersConnection = Schema.Schema.Type<typeof RawCompletedOrdersConnectionSchema>

export const RawCompletedOrdersGraphqlResponseSchema = Schema.revealCodec(
  Schema.Struct({
    data: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({ completedOrders: Schema.NullOr(RawCompletedOrdersConnectionSchema) }).pipe(
          withUnknownStringFields
        )
      )
    ),
    errors: Schema.optionalKey(Schema.Array(RawCompletedOrdersGraphqlErrorSchema))
  }).pipe(withUnknownStringFields)
)

export type RawCompletedOrdersGraphqlResponse = Schema.Schema.Type<typeof RawCompletedOrdersGraphqlResponseSchema>

export const CompletedOrdersPaginationSchema = Schema.Struct({
  hasNextPage: Schema.Boolean,
  nextPageToken: Schema.optionalKey(PageTokenSchema),
  retentionPeriod: Schema.optionalKey(Schema.String)
})

export type CompletedOrdersPagination = Schema.Schema.Type<typeof CompletedOrdersPaginationSchema>

export const NormalizedCompletedOrderSchema = Schema.Struct({
  addressNickName: Schema.String,
  carrierId: Schema.optionalKey(Schema.String),
  dates: Schema.Struct({ deliveryEndDate: Schema.String, deliveryStartDate: Schema.String, timeZoneId: Schema.String }),
  deliveryMethod: Schema.String,
  externalAddress: Schema.optionalKey(Schema.Struct({ externalCollectionPointId: Schema.String })),
  orderId: Schema.String,
  orderTotals: Schema.Struct({ totalPrice: MoneySchema }),
  recurringShoppingDefinition: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  regionId: Schema.String,
  retailerRegionId: Schema.String,
  shippingGroupType: Schema.optionalKey(Schema.String),
  slotType: Schema.String,
  status: Schema.String
})

export type NormalizedCompletedOrder = Schema.Schema.Type<typeof NormalizedCompletedOrderSchema>

export const NormalizedCompletedOrdersResultSchema = Schema.Struct({
  orders: Schema.Array(NormalizedCompletedOrderSchema),
  pagination: CompletedOrdersPaginationSchema
})

export type NormalizedCompletedOrdersResult = Schema.Schema.Type<typeof NormalizedCompletedOrdersResultSchema>
