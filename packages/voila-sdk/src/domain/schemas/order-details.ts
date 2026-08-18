import { Effect, Schema } from "effect"

import { MoneySchema } from "./money.js"

import { withUnknownStringFields } from "./unknown-fields.js"

export const MAX_COMPLETED_ORDER_ITEM_SCAN = 50
export const DEFAULT_COMPLETED_ORDER_ITEM_SCAN = 20

const NonEmptyTrimmedStringSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1))
)
const IsoDateStringSchema = NonEmptyTrimmedStringSchema.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)))
const NonNegativeNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
)
const PositiveOrderScanSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.check(Schema.isLessThanOrEqualTo(MAX_COMPLETED_ORDER_ITEM_SCAN))
)

export const OrderDetailsInputSchema = Schema.Struct({ orderId: NonEmptyTrimmedStringSchema })

export type OrderDetailsInput = Schema.Schema.Type<typeof OrderDetailsInputSchema>

export const CompletedOrderItemsInputSchema = Schema.Struct({
  fromDate: Schema.optionalKey(IsoDateStringSchema),
  maxOrders: PositiveOrderScanSchema.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_COMPLETED_ORDER_ITEM_SCAN))
  ),
  pageSize: Schema.optionalKey(PositiveOrderScanSchema),
  pageToken: Schema.optionalKey(NonEmptyTrimmedStringSchema),
  toDate: Schema.optionalKey(IsoDateStringSchema)
})

export type CompletedOrderItemsInput = Schema.Schema.Type<typeof CompletedOrderItemsInputSchema>

const RawOrderDetailSellerSchema = Schema.revealCodec(
  Schema.Struct({ id: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) }).pipe(
    withUnknownStringFields
  )
)

const RawOrderDetailProductPriceSchema = Schema.revealCodec(
  Schema.Struct({ current: Schema.optionalKey(MoneySchema) }).pipe(withUnknownStringFields)
)

export const RawOrderDetailProductSchema = Schema.revealCodec(
  Schema.Struct({
    brand: Schema.optionalKey(Schema.String),
    isInCurrentCatalog: Schema.optionalKey(Schema.Boolean),
    name: Schema.optionalKey(Schema.String),
    price: Schema.optionalKey(RawOrderDetailProductPriceSchema),
    productId: Schema.optionalKey(Schema.String),
    retailerProductId: Schema.optionalKey(Schema.String),
    seller: Schema.optionalKey(RawOrderDetailSellerSchema),
    sellerId: Schema.optionalKey(Schema.String),
    sellerName: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

export type RawOrderDetailProduct = Schema.Schema.Type<typeof RawOrderDetailProductSchema>

export const RawOrderDetailProductReferenceSchema = Schema.Union([RawOrderDetailProductSchema, Schema.String])

export type RawOrderDetailProductReference = Schema.Schema.Type<typeof RawOrderDetailProductReferenceSchema>

const RawOrderDetailBaseItemFields = {
  finalPrice: Schema.optionalKey(MoneySchema),
  isInCurrentCatalog: Schema.optionalKey(Schema.Boolean),
  price: Schema.optionalKey(MoneySchema),
  product: Schema.optionalKey(RawOrderDetailProductReferenceSchema),
  productId: Schema.optionalKey(Schema.String),
  quantity: Schema.optionalKey(NonNegativeNumberSchema),
  sample: Schema.optionalKey(Schema.Boolean),
  totalPrice: Schema.optionalKey(MoneySchema)
}

const RawOrderDetailBaseItemSchema = Schema.revealCodec(
  withUnknownStringFields(Schema.Struct(RawOrderDetailBaseItemFields))
)

export const RawOrderDetailItemSchema = Schema.revealCodec(
  withUnknownStringFields(
    Schema.Struct({
      ...RawOrderDetailBaseItemFields,
      substitutes: Schema.optionalKey(Schema.Array(RawOrderDetailBaseItemSchema))
    })
  )
)

export type RawOrderDetailItem = Schema.Schema.Type<typeof RawOrderDetailItemSchema>

const RawOrderDetailRegionSchema = Schema.revealCodec(
  Schema.Struct({
    regionId: Schema.optionalKey(Schema.String),
    retailerRegionId: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

const RawOrderDetailSlotSchema = Schema.revealCodec(
  Schema.Struct({
    end: Schema.optionalKey(Schema.String),
    start: Schema.optionalKey(Schema.String),
    timeZone: Schema.optionalKey(Schema.String)
  }).pipe(withUnknownStringFields)
)

const RawOrderDetailPricesSchema = Schema.revealCodec(
  Schema.Struct({ total: Schema.optionalKey(MoneySchema) }).pipe(withUnknownStringFields)
)

export const RawOrderDetailOrderSchema = Schema.revealCodec(
  Schema.Struct({
    items: Schema.optionalKey(Schema.Array(RawOrderDetailItemSchema)),
    itemsOnCheckout: Schema.optionalKey(Schema.Array(RawOrderDetailItemSchema)),
    missingItems: Schema.optionalKey(Schema.Array(RawOrderDetailItemSchema)),
    orderId: Schema.String,
    orderReference: Schema.optionalKey(Schema.String),
    prices: Schema.optionalKey(RawOrderDetailPricesSchema),
    region: Schema.optionalKey(RawOrderDetailRegionSchema),
    returnedItems: Schema.optionalKey(Schema.Array(RawOrderDetailItemSchema)),
    slot: Schema.optionalKey(RawOrderDetailSlotSchema),
    status: Schema.optionalKey(Schema.String),
    substitutedItems: Schema.optionalKey(Schema.Array(RawOrderDetailItemSchema))
  }).pipe(withUnknownStringFields)
)

export type RawOrderDetailOrder = Schema.Schema.Type<typeof RawOrderDetailOrderSchema>

export const RawDecoratedOrderResponseSchema = Schema.revealCodec(
  Schema.Struct({
    entities: Schema.Struct({
      order: Schema.Record(Schema.String, RawOrderDetailOrderSchema),
      product: Schema.optionalKey(Schema.Record(Schema.String, RawOrderDetailProductSchema))
    }).pipe(withUnknownStringFields)
  }).pipe(withUnknownStringFields)
)

export type RawDecoratedOrderResponse = Schema.Schema.Type<typeof RawDecoratedOrderResponseSchema>

export const OrderItemGroupKindSchema = Schema.Literals(["atRisk", "missing", "received", "returned", "substituted"])

export type OrderItemGroupKind = Schema.Schema.Type<typeof OrderItemGroupKindSchema>

export const SubstitutionRoleSchema = Schema.Literals(["requested", "substitute"])

export type SubstitutionRole = Schema.Schema.Type<typeof SubstitutionRoleSchema>

export const NormalizedOrderItemSchema = Schema.Struct({
  brand: Schema.optionalKey(Schema.String),
  groupKind: OrderItemGroupKindSchema,
  isInCurrentCatalog: Schema.optionalKey(Schema.Boolean),
  name: Schema.optionalKey(Schema.String),
  productId: Schema.optionalKey(Schema.String),
  quantity: NonNegativeNumberSchema,
  retailerProductId: Schema.optionalKey(Schema.String),
  sample: Schema.optionalKey(Schema.Boolean),
  sellerId: Schema.optionalKey(Schema.String),
  sellerName: Schema.optionalKey(Schema.String),
  substitutionForProductId: Schema.optionalKey(Schema.String),
  substitutionRole: Schema.optionalKey(SubstitutionRoleSchema),
  totalPrice: Schema.optionalKey(MoneySchema),
  unitPrice: Schema.optionalKey(MoneySchema)
})

export type NormalizedOrderItem = Schema.Schema.Type<typeof NormalizedOrderItemSchema>

export const NormalizedOrderItemGroupSchema = Schema.Struct({
  items: Schema.Array(NormalizedOrderItemSchema),
  kind: OrderItemGroupKindSchema
})

export type NormalizedOrderItemGroup = Schema.Schema.Type<typeof NormalizedOrderItemGroupSchema>

export const NormalizedOrderDetailsResultSchema = Schema.Struct({
  dates: Schema.optionalKey(
    Schema.Struct({
      deliveryEndDate: Schema.optionalKey(Schema.String),
      deliveryStartDate: Schema.optionalKey(Schema.String),
      timeZoneId: Schema.optionalKey(Schema.String)
    })
  ),
  itemGroups: Schema.Array(NormalizedOrderItemGroupSchema),
  items: Schema.Array(NormalizedOrderItemSchema),
  orderId: Schema.String,
  orderReference: Schema.optionalKey(Schema.String),
  orderTotals: Schema.optionalKey(Schema.Struct({ totalPrice: MoneySchema })),
  regionId: Schema.optionalKey(Schema.String),
  retailerRegionId: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String)
})

export type NormalizedOrderDetailsResult = Schema.Schema.Type<typeof NormalizedOrderDetailsResultSchema>

export const NormalizedCompletedOrderItemSchema = Schema.Struct({
  brand: Schema.optionalKey(Schema.String),
  itemKey: Schema.String,
  lastOrderId: Schema.optionalKey(Schema.String),
  lastOrderedAt: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  orderCount: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  orderIds: Schema.Array(Schema.String),
  productId: Schema.optionalKey(Schema.String),
  retailerProductId: Schema.optionalKey(Schema.String),
  totalQuantity: NonNegativeNumberSchema,
  totalSpend: Schema.optionalKey(MoneySchema)
})

export type NormalizedCompletedOrderItem = Schema.Schema.Type<typeof NormalizedCompletedOrderItemSchema>

export const NormalizedCompletedOrderItemsResultSchema = Schema.Struct({
  itemCount: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  items: Schema.Array(NormalizedCompletedOrderItemSchema),
  ordersMatched: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  ordersScanned: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  pagination: Schema.Struct({
    hasNextPage: Schema.Boolean,
    nextPageToken: Schema.optionalKey(Schema.String),
    retentionPeriod: Schema.optionalKey(Schema.String)
  })
})

export type NormalizedCompletedOrderItemsResult = Schema.Schema.Type<typeof NormalizedCompletedOrderItemsResultSchema>
