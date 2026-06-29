import { Schema } from "effect"

import { MoneySchema } from "./money.js"

export const MIN_ORDER_PAGE_SIZE = 1
export const MAX_ORDER_PAGE_SIZE = 50
export const DEFAULT_ORDER_PAGE_SIZE = 20

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)
const OrderPageSizeSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(MIN_ORDER_PAGE_SIZE),
  Schema.lessThanOrEqualTo(MAX_ORDER_PAGE_SIZE)
)

export const CompletedOrdersInputSchema = Schema.Struct({
  pageSize: Schema.optionalWith(OrderPageSizeSchema, { default: () => DEFAULT_ORDER_PAGE_SIZE }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true })
})

export type CompletedOrdersInput = Schema.Schema.Type<typeof CompletedOrdersInputSchema>

const RawOrderRegionSchema = Schema.asSchema(
  Schema.Struct({
    regionId: Schema.String,
    retailerRegionId: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderCarrierSchema = Schema.asSchema(
  Schema.Struct({
    carrierId: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderExternalLockerSchema = Schema.asSchema(
  Schema.Struct({
    externalLockerId: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderDeliveryDestinationSchema = Schema.asSchema(
  Schema.Struct({
    address: Schema.Struct({
      timeZone: Schema.String
    }).pipe(Schema.extend(UnknownStringRecordSchema)),
    deliveryMethod: Schema.String,
    name: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export const RawInternalCompletedOrderSlotSchema = Schema.asSchema(
  Schema.Struct({
    __typename: Schema.Literal("InternalOrderSlot"),
    carrier: Schema.optionalWith(Schema.NullOr(RawOrderCarrierSchema), { exact: true }),
    deliveryDestination: RawOrderDeliveryDestinationSchema,
    end: Schema.String,
    externalLocker: Schema.optionalWith(Schema.NullOr(RawOrderExternalLockerSchema), { exact: true }),
    shippingGroupType: Schema.optionalWith(Schema.String, { exact: true }),
    start: Schema.String,
    type: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawInternalCompletedOrderSlot = Schema.Schema.Type<typeof RawInternalCompletedOrderSlotSchema>

export const RawImportedCompletedOrderSlotSchema = Schema.asSchema(
  Schema.Struct({
    __typename: Schema.Literal("ImportedOrderSlot"),
    end: Schema.String,
    name: Schema.String,
    start: Schema.String,
    timeZone: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawImportedCompletedOrderSlot = Schema.Schema.Type<typeof RawImportedCompletedOrderSlotSchema>

export const RawCompletedOrderSlotSchema = Schema.Union(
  RawInternalCompletedOrderSlotSchema,
  RawImportedCompletedOrderSlotSchema
)

export type RawCompletedOrderSlot = Schema.Schema.Type<typeof RawCompletedOrderSlotSchema>

export const RawCompletedOrderNodeSchema = Schema.asSchema(
  Schema.Struct({
    orderId: Schema.String,
    prices: Schema.Struct({
      total: MoneySchema
    }).pipe(Schema.extend(UnknownStringRecordSchema)),
    recurringOrderDefinition: Schema.optionalWith(
      Schema.NullOr(
        Schema.Struct({
          name: Schema.String
        }).pipe(Schema.extend(UnknownStringRecordSchema))
      ),
      { exact: true }
    ),
    region: RawOrderRegionSchema,
    slot: RawCompletedOrderSlotSchema,
    status: Schema.String
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawCompletedOrderNode = Schema.Schema.Type<typeof RawCompletedOrderNodeSchema>

export const RawCompletedOrdersGraphqlResponseSchema = Schema.asSchema(
  Schema.Struct({
    data: Schema.Struct({
      completedOrders: Schema.Struct({
        edges: Schema.Array(Schema.NullOr(
          Schema.Struct({
            node: Schema.NullOr(RawCompletedOrderNodeSchema)
          }).pipe(Schema.extend(UnknownStringRecordSchema))
        )),
        pageInfo: Schema.Struct({
          endCursor: Schema.NullOr(Schema.String),
          hasNextPage: Schema.Boolean
        }).pipe(Schema.extend(UnknownStringRecordSchema)),
        retentionPeriod: Schema.optionalWith(Schema.String, { exact: true })
      }).pipe(Schema.extend(UnknownStringRecordSchema))
    }).pipe(Schema.extend(UnknownStringRecordSchema))
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawCompletedOrdersGraphqlResponse = Schema.Schema.Type<typeof RawCompletedOrdersGraphqlResponseSchema>

export const CompletedOrdersPaginationSchema = Schema.Struct({
  hasNextPage: Schema.Boolean,
  nextPageToken: Schema.optionalWith(Schema.String, { exact: true }),
  retentionPeriod: Schema.optionalWith(Schema.String, { exact: true })
})

export type CompletedOrdersPagination = Schema.Schema.Type<typeof CompletedOrdersPaginationSchema>

export const NormalizedCompletedOrderSchema = Schema.Struct({
  addressNickName: Schema.String,
  carrierId: Schema.optionalWith(Schema.String, { exact: true }),
  dates: Schema.Struct({
    deliveryEndDate: Schema.String,
    deliveryStartDate: Schema.String,
    timeZoneId: Schema.String
  }),
  deliveryMethod: Schema.String,
  externalAddress: Schema.optionalWith(
    Schema.Struct({
      externalCollectionPointId: Schema.String
    }),
    { exact: true }
  ),
  orderId: Schema.String,
  orderTotals: Schema.Struct({
    totalPrice: MoneySchema
  }),
  recurringShoppingDefinition: Schema.optionalWith(
    Schema.Struct({
      name: Schema.String
    }),
    { exact: true }
  ),
  regionId: Schema.String,
  retailerRegionId: Schema.String,
  shippingGroupType: Schema.optionalWith(Schema.String, { exact: true }),
  slotType: Schema.String,
  status: Schema.String
})

export type NormalizedCompletedOrder = Schema.Schema.Type<typeof NormalizedCompletedOrderSchema>

export const NormalizedCompletedOrdersResultSchema = Schema.Struct({
  orders: Schema.Array(NormalizedCompletedOrderSchema),
  pagination: CompletedOrdersPaginationSchema
})

export type NormalizedCompletedOrdersResult = Schema.Schema.Type<typeof NormalizedCompletedOrdersResultSchema>
