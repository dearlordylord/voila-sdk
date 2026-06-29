import { Schema } from "effect"

import { MoneySchema } from "./money.js"

export const MAX_COMPLETED_ORDER_ITEM_SCAN = 50
export const DEFAULT_COMPLETED_ORDER_ITEM_SCAN = 20

const UnknownStringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.trimmed(),
  Schema.minLength(1)
)
const IsoDateStringSchema = NonEmptyTrimmedStringSchema.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)
)
const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative()
)
const PositiveOrderScanSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(MAX_COMPLETED_ORDER_ITEM_SCAN)
)

export const OrderDetailsInputSchema = Schema.Struct({
  orderId: NonEmptyTrimmedStringSchema
})

export type OrderDetailsInput = Schema.Schema.Type<typeof OrderDetailsInputSchema>

export const CompletedOrderItemsInputSchema = Schema.Struct({
  fromDate: Schema.optionalWith(IsoDateStringSchema, { exact: true }),
  maxOrders: Schema.optionalWith(PositiveOrderScanSchema, { default: () => DEFAULT_COMPLETED_ORDER_ITEM_SCAN }),
  pageSize: Schema.optionalWith(PositiveOrderScanSchema, { exact: true }),
  pageToken: Schema.optionalWith(NonEmptyTrimmedStringSchema, { exact: true }),
  toDate: Schema.optionalWith(IsoDateStringSchema, { exact: true })
})

export type CompletedOrderItemsInput = Schema.Schema.Type<typeof CompletedOrderItemsInputSchema>

const RawOrderDetailSellerSchema = Schema.asSchema(
  Schema.Struct({
    id: Schema.optionalWith(Schema.String, { exact: true }),
    name: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderDetailProductPriceSchema = Schema.asSchema(
  Schema.Struct({
    current: Schema.optionalWith(MoneySchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export const RawOrderDetailProductSchema = Schema.asSchema(
  Schema.Struct({
    brand: Schema.optionalWith(Schema.String, { exact: true }),
    isInCurrentCatalog: Schema.optionalWith(Schema.Boolean, { exact: true }),
    name: Schema.optionalWith(Schema.String, { exact: true }),
    price: Schema.optionalWith(RawOrderDetailProductPriceSchema, { exact: true }),
    productId: Schema.optionalWith(Schema.String, { exact: true }),
    retailerProductId: Schema.optionalWith(Schema.String, { exact: true }),
    seller: Schema.optionalWith(RawOrderDetailSellerSchema, { exact: true }),
    sellerId: Schema.optionalWith(Schema.String, { exact: true }),
    sellerName: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawOrderDetailProduct = Schema.Schema.Type<typeof RawOrderDetailProductSchema>

export const RawOrderDetailProductReferenceSchema = Schema.Union(RawOrderDetailProductSchema, Schema.String)

export type RawOrderDetailProductReference = Schema.Schema.Type<typeof RawOrderDetailProductReferenceSchema>

const RawOrderDetailBaseItemSchema = Schema.asSchema(
  Schema.Struct({
    finalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
    isInCurrentCatalog: Schema.optionalWith(Schema.Boolean, { exact: true }),
    price: Schema.optionalWith(MoneySchema, { exact: true }),
    product: Schema.optionalWith(RawOrderDetailProductReferenceSchema, { exact: true }),
    productId: Schema.optionalWith(Schema.String, { exact: true }),
    quantity: Schema.optionalWith(NonNegativeNumberSchema, { exact: true }),
    sample: Schema.optionalWith(Schema.Boolean, { exact: true }),
    totalPrice: Schema.optionalWith(MoneySchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export const RawOrderDetailItemSchema = Schema.asSchema(
  RawOrderDetailBaseItemSchema.pipe(Schema.extend(Schema.Struct({
    substitutes: Schema.optionalWith(Schema.Array(RawOrderDetailBaseItemSchema), { exact: true })
  })))
)

export type RawOrderDetailItem = Schema.Schema.Type<typeof RawOrderDetailItemSchema>

const RawOrderDetailRegionSchema = Schema.asSchema(
  Schema.Struct({
    regionId: Schema.optionalWith(Schema.String, { exact: true }),
    retailerRegionId: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderDetailSlotSchema = Schema.asSchema(
  Schema.Struct({
    end: Schema.optionalWith(Schema.String, { exact: true }),
    start: Schema.optionalWith(Schema.String, { exact: true }),
    timeZone: Schema.optionalWith(Schema.String, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

const RawOrderDetailPricesSchema = Schema.asSchema(
  Schema.Struct({
    total: Schema.optionalWith(MoneySchema, { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export const RawOrderDetailOrderSchema = Schema.asSchema(
  Schema.Struct({
    items: Schema.optionalWith(Schema.Array(RawOrderDetailItemSchema), { exact: true }),
    itemsOnCheckout: Schema.optionalWith(Schema.Array(RawOrderDetailItemSchema), { exact: true }),
    missingItems: Schema.optionalWith(Schema.Array(RawOrderDetailItemSchema), { exact: true }),
    orderId: Schema.String,
    orderReference: Schema.optionalWith(Schema.String, { exact: true }),
    prices: Schema.optionalWith(RawOrderDetailPricesSchema, { exact: true }),
    region: Schema.optionalWith(RawOrderDetailRegionSchema, { exact: true }),
    returnedItems: Schema.optionalWith(Schema.Array(RawOrderDetailItemSchema), { exact: true }),
    slot: Schema.optionalWith(RawOrderDetailSlotSchema, { exact: true }),
    status: Schema.optionalWith(Schema.String, { exact: true }),
    substitutedItems: Schema.optionalWith(Schema.Array(RawOrderDetailItemSchema), { exact: true })
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawOrderDetailOrder = Schema.Schema.Type<typeof RawOrderDetailOrderSchema>

export const RawDecoratedOrderResponseSchema = Schema.asSchema(
  Schema.Struct({
    entities: Schema.Struct({
      order: Schema.Record({ key: Schema.String, value: RawOrderDetailOrderSchema }),
      product: Schema.optionalWith(Schema.Record({ key: Schema.String, value: RawOrderDetailProductSchema }), {
        exact: true
      })
    }).pipe(Schema.extend(UnknownStringRecordSchema))
  }).pipe(Schema.extend(UnknownStringRecordSchema))
)

export type RawDecoratedOrderResponse = Schema.Schema.Type<typeof RawDecoratedOrderResponseSchema>

export const OrderItemGroupKindSchema = Schema.Literal("atRisk", "missing", "received", "returned", "substituted")

export type OrderItemGroupKind = Schema.Schema.Type<typeof OrderItemGroupKindSchema>

export const SubstitutionRoleSchema = Schema.Literal("requested", "substitute")

export type SubstitutionRole = Schema.Schema.Type<typeof SubstitutionRoleSchema>

export const NormalizedOrderItemSchema = Schema.Struct({
  brand: Schema.optionalWith(Schema.String, { exact: true }),
  groupKind: OrderItemGroupKindSchema,
  isInCurrentCatalog: Schema.optionalWith(Schema.Boolean, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  productId: Schema.optionalWith(Schema.String, { exact: true }),
  quantity: NonNegativeNumberSchema,
  retailerProductId: Schema.optionalWith(Schema.String, { exact: true }),
  sample: Schema.optionalWith(Schema.Boolean, { exact: true }),
  sellerId: Schema.optionalWith(Schema.String, { exact: true }),
  sellerName: Schema.optionalWith(Schema.String, { exact: true }),
  substitutionForProductId: Schema.optionalWith(Schema.String, { exact: true }),
  substitutionRole: Schema.optionalWith(SubstitutionRoleSchema, { exact: true }),
  totalPrice: Schema.optionalWith(MoneySchema, { exact: true }),
  unitPrice: Schema.optionalWith(MoneySchema, { exact: true })
})

export type NormalizedOrderItem = Schema.Schema.Type<typeof NormalizedOrderItemSchema>

export const NormalizedOrderItemGroupSchema = Schema.Struct({
  items: Schema.Array(NormalizedOrderItemSchema),
  kind: OrderItemGroupKindSchema
})

export type NormalizedOrderItemGroup = Schema.Schema.Type<typeof NormalizedOrderItemGroupSchema>

export const NormalizedOrderDetailsResultSchema = Schema.Struct({
  dates: Schema.optionalWith(
    Schema.Struct({
      deliveryEndDate: Schema.optionalWith(Schema.String, { exact: true }),
      deliveryStartDate: Schema.optionalWith(Schema.String, { exact: true }),
      timeZoneId: Schema.optionalWith(Schema.String, { exact: true })
    }),
    { exact: true }
  ),
  itemGroups: Schema.Array(NormalizedOrderItemGroupSchema),
  items: Schema.Array(NormalizedOrderItemSchema),
  orderId: Schema.String,
  orderReference: Schema.optionalWith(Schema.String, { exact: true }),
  orderTotals: Schema.optionalWith(
    Schema.Struct({
      totalPrice: MoneySchema
    }),
    { exact: true }
  ),
  regionId: Schema.optionalWith(Schema.String, { exact: true }),
  retailerRegionId: Schema.optionalWith(Schema.String, { exact: true }),
  status: Schema.optionalWith(Schema.String, { exact: true })
})

export type NormalizedOrderDetailsResult = Schema.Schema.Type<typeof NormalizedOrderDetailsResultSchema>

export const NormalizedCompletedOrderItemSchema = Schema.Struct({
  brand: Schema.optionalWith(Schema.String, { exact: true }),
  itemKey: Schema.String,
  lastOrderId: Schema.optionalWith(Schema.String, { exact: true }),
  lastOrderedAt: Schema.optionalWith(Schema.String, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  orderCount: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  orderIds: Schema.Array(Schema.String),
  productId: Schema.optionalWith(Schema.String, { exact: true }),
  retailerProductId: Schema.optionalWith(Schema.String, { exact: true }),
  totalQuantity: NonNegativeNumberSchema,
  totalSpend: Schema.optionalWith(MoneySchema, { exact: true })
})

export type NormalizedCompletedOrderItem = Schema.Schema.Type<typeof NormalizedCompletedOrderItemSchema>

export const NormalizedCompletedOrderItemsResultSchema = Schema.Struct({
  itemCount: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  items: Schema.Array(NormalizedCompletedOrderItemSchema),
  ordersMatched: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  ordersScanned: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
  pagination: Schema.Struct({
    hasNextPage: Schema.Boolean,
    nextPageToken: Schema.optionalWith(Schema.String, { exact: true }),
    retentionPeriod: Schema.optionalWith(Schema.String, { exact: true })
  })
})

export type NormalizedCompletedOrderItemsResult = Schema.Schema.Type<
  typeof NormalizedCompletedOrderItemsResultSchema
>
