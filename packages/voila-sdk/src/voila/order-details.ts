import { Effect, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type CompletedOrderItemsInput,
  CompletedOrderItemsInputSchema,
  type Money,
  type NormalizedCompletedOrder,
  type NormalizedCompletedOrderItem,
  type NormalizedCompletedOrderItemsResult,
  type NormalizedOrderDetailsResult,
  type NormalizedOrderItem,
  type NormalizedOrderItemGroup,
  type OrderItemGroupKind,
  type RawDecoratedOrderResponse,
  RawDecoratedOrderResponseSchema,
  type RawOrderDetailItem,
  type RawOrderDetailOrder,
  type RawOrderDetailProduct,
  type RawOrderDetailProductReference,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import { getCompletedOrders, type GetCompletedOrdersError } from "./order-history.js"
import type { OrderDetailsRequestError } from "./order-urls.js"
import { makeOrderDetailsRequest } from "./order-urls.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"

export type OrderDetailsUnavailableError = { readonly _tag: "OrderDetailsUnavailable"; readonly message: string }

export type CompletedOrderItemsInputInvalidError = {
  readonly _tag: "CompletedOrderItemsInputInvalid"
  readonly message: string
}

export type GetOrderDetailsError = OrderDetailsRequestError | OrderDetailsUnavailableError | VoilaSdkError

export type GetCompletedOrderItemsError =
  | CompletedOrderItemsInputInvalidError
  | GetCompletedOrdersError
  | GetOrderDetailsError

export type GetOrderDetailsResult = VoilaJsonResult<NormalizedOrderDetailsResult>
export type GetCompletedOrderItemsResult = VoilaJsonResult<NormalizedCompletedOrderItemsResult>

type ProductDirectory = Readonly<Record<string, RawOrderDetailProduct>>

interface ItemAggregate {
  readonly brand?: string
  readonly itemKey: string
  readonly lastOrderId: string
  readonly lastOrderedAt: string
  readonly name?: string
  readonly orderIds: ReadonlySet<string>
  readonly productId?: string
  readonly retailerProductId?: string
  readonly spendCents?: number
  readonly spendCurrency?: string
  readonly totalQuantity: number
}

const receivedKind: OrderItemGroupKind = "received"
const substitutedKind: OrderItemGroupKind = "substituted"
const missingKind: OrderItemGroupKind = "missing"
const returnedKind: OrderItemGroupKind = "returned"
const atRiskKind: OrderItemGroupKind = "atRisk"
const decimalRadix = 10
const centsPerUnit = 100
const firstOrder = 0

const inputInvalid = (): CompletedOrderItemsInputInvalidError => ({
  _tag: "CompletedOrderItemsInputInvalid",
  message: "Completed order items request input does not match the SDK schema"
})

const orderDetailsUnavailable = (): OrderDetailsUnavailableError => ({
  _tag: "OrderDetailsUnavailable",
  message: "Voila decorated order details are unavailable for the requested order"
})

const firstRecordValue = <A>(record: Readonly<Record<string, A>>): A | undefined => {
  for (const value of Object.values(record)) {
    return value
  }

  return undefined
}

const resolveProduct = (
  reference: RawOrderDetailProductReference | undefined,
  products: ProductDirectory
): RawOrderDetailProduct | undefined => {
  if (reference === undefined) {
    return undefined
  }

  return typeof reference === "string" ? products[reference] : reference
}

const productIdFor = (item: RawOrderDetailItem, product: RawOrderDetailProduct | undefined): string | undefined =>
  product?.productId ?? item.productId

const quantityFor = (item: RawOrderDetailItem): number => item.quantity ?? 1

const unitPriceFor = (item: RawOrderDetailItem, product: RawOrderDetailProduct | undefined): Money | undefined =>
  item.price ?? product?.price?.current

const makeNormalizedItem = (
  item: RawOrderDetailItem,
  groupKind: OrderItemGroupKind,
  products: ProductDirectory,
  substitutionForProductId?: string,
  substitutionRole?: "requested" | "substitute"
): NormalizedOrderItem => {
  const product = resolveProduct(item.product, products)
  const productId = productIdFor(item, product)
  const totalPrice = item.finalPrice ?? item.totalPrice
  const unitPrice = unitPriceFor(item, product)
  const isInCurrentCatalog = item.isInCurrentCatalog ?? product?.isInCurrentCatalog
  const sellerId = product?.sellerId ?? product?.seller?.id
  const sellerName = product?.sellerName ?? product?.seller?.name

  return {
    groupKind,
    quantity: quantityFor(item),
    ...(product?.brand === undefined ? {} : { brand: product.brand }),
    ...(isInCurrentCatalog === undefined ? {} : { isInCurrentCatalog }),
    ...(product?.name === undefined ? {} : { name: product.name }),
    ...(productId === undefined ? {} : { productId }),
    ...(product?.retailerProductId === undefined ? {} : { retailerProductId: product.retailerProductId }),
    ...(item.sample === undefined ? {} : { sample: item.sample }),
    ...(sellerId === undefined ? {} : { sellerId }),
    ...(sellerName === undefined ? {} : { sellerName }),
    ...(substitutionForProductId === undefined ? {} : { substitutionForProductId }),
    ...(substitutionRole === undefined ? {} : { substitutionRole }),
    ...(totalPrice === undefined ? {} : { totalPrice }),
    ...(unitPrice === undefined ? {} : { unitPrice })
  }
}

const normalizePlainGroup = (
  kind: OrderItemGroupKind,
  items: ReadonlyArray<RawOrderDetailItem> | undefined,
  products: ProductDirectory
): NormalizedOrderItemGroup => ({ items: (items ?? []).map((item) => makeNormalizedItem(item, kind, products)), kind })

const normalizeSubstitutionGroup = (
  items: ReadonlyArray<RawOrderDetailItem> | undefined,
  products: ProductDirectory
): NormalizedOrderItemGroup => ({
  items: (items ?? []).flatMap((item) => {
    const requested = makeNormalizedItem(item, substitutedKind, products, undefined, "requested")
    const substitutes = (item.substitutes ?? []).map((substitute) =>
      makeNormalizedItem(substitute, substitutedKind, products, requested.productId, "substitute")
    )

    return [requested, ...substitutes]
  }),
  kind: substitutedKind
})

const normalizeItemGroups = (
  order: RawOrderDetailOrder,
  products: ProductDirectory
): ReadonlyArray<NormalizedOrderItemGroup> =>
  [
    normalizePlainGroup(receivedKind, order.items, products),
    normalizeSubstitutionGroup(order.substitutedItems, products),
    normalizePlainGroup(missingKind, order.missingItems, products),
    normalizePlainGroup(returnedKind, order.returnedItems, products),
    normalizePlainGroup(atRiskKind, order.itemsOnCheckout, products)
  ].filter((group) => group.items.length > 0)

const datesFor = (order: RawOrderDetailOrder) =>
  order.slot?.start === undefined && order.slot?.end === undefined && order.slot?.timeZone === undefined
    ? {}
    : {
        dates: {
          ...(order.slot.start === undefined ? {} : { deliveryStartDate: order.slot.start }),
          ...(order.slot.end === undefined ? {} : { deliveryEndDate: order.slot.end }),
          ...(order.slot.timeZone === undefined ? {} : { timeZoneId: order.slot.timeZone })
        }
      }

export const normalizeOrderDetailsResponse = (
  response: RawDecoratedOrderResponse,
  orderId: string
): Result.Result<NormalizedOrderDetailsResult, OrderDetailsUnavailableError> => {
  const order = response.entities.order[orderId] ?? firstRecordValue(response.entities.order)

  if (order === undefined) {
    return Result.fail(orderDetailsUnavailable())
  }

  const products = response.entities.product ?? {}
  const itemGroups = normalizeItemGroups(order, products)
  const items = itemGroups.flatMap((group) => group.items)

  return Result.succeed({
    ...datesFor(order),
    itemGroups,
    items,
    orderId: order.orderId,
    ...(order.orderReference === undefined ? {} : { orderReference: order.orderReference }),
    ...(order.prices?.total === undefined ? {} : { orderTotals: { totalPrice: order.prices.total } }),
    ...(order.region?.regionId === undefined ? {} : { regionId: order.region.regionId }),
    ...(order.region?.retailerRegionId === undefined ? {} : { retailerRegionId: order.region.retailerRegionId }),
    ...(order.status === undefined ? {} : { status: order.status })
  })
}

const parseCents = (money: Money): number | undefined => {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(money.amount)
  const whole = match?.[1]

  if (whole === undefined) {
    return undefined
  }

  const fractional = match?.[2] ?? ""
  const centsText = fractional.length === 1 ? `${fractional}0` : fractional.padEnd(2, "0")

  return Number.parseInt(whole, decimalRadix) * centsPerUnit + Number.parseInt(centsText, decimalRadix)
}

const formatCents = (cents: number): string => {
  const whole = Math.trunc(cents / centsPerUnit)
  const fractional = `${cents % centsPerUnit}`.padStart(2, "0")

  return `${whole}.${fractional}`
}

const datePart = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length < "yyyy-mm-dd".length) {
    return undefined
  }

  return value.slice(0, "yyyy-mm-dd".length)
}

const isInRange = (order: NormalizedCompletedOrder, input: CompletedOrderItemsInput): boolean => {
  const deliveredAt = datePart(order.dates.deliveryEndDate)

  if (deliveredAt === undefined) {
    return false
  }

  if (input.fromDate !== undefined && deliveredAt < input.fromDate) {
    return false
  }

  return input.toDate === undefined || deliveredAt <= input.toDate
}

const itemKeyFor = (item: NormalizedOrderItem): string =>
  item.productId ?? item.retailerProductId ?? item.name ?? "unknown-product"

const aggregateItem = (
  aggregate: ItemAggregate | undefined,
  item: NormalizedOrderItem,
  order: NormalizedCompletedOrder
): ItemAggregate => {
  const orderIds = new Set(aggregate?.orderIds ?? [])
  orderIds.add(order.orderId)
  const cents = item.totalPrice === undefined ? undefined : parseCents(item.totalPrice)
  const nextSpend =
    aggregate?.spendCents === undefined || cents === undefined || aggregate.spendCurrency !== item.totalPrice?.currency
      ? undefined
      : aggregate.spendCents + cents
  const initialSpend =
    aggregate === undefined && cents !== undefined && item.totalPrice !== undefined ? cents : nextSpend
  const brand = item.brand ?? aggregate?.brand
  const name = item.name ?? aggregate?.name
  const productId = item.productId ?? aggregate?.productId
  const retailerProductId = item.retailerProductId ?? aggregate?.retailerProductId
  const spendCurrency = item.totalPrice?.currency ?? aggregate?.spendCurrency
  const lastOrderId = aggregate?.lastOrderId ?? order.orderId
  const lastOrderedAt = aggregate?.lastOrderedAt ?? order.dates.deliveryEndDate

  return {
    itemKey: itemKeyFor(item),
    orderIds,
    totalQuantity: (aggregate?.totalQuantity ?? 0) + item.quantity,
    ...(brand === undefined ? {} : { brand }),
    lastOrderId,
    lastOrderedAt,
    ...(name === undefined ? {} : { name }),
    ...(productId === undefined ? {} : { productId }),
    ...(retailerProductId === undefined ? {} : { retailerProductId }),
    ...(initialSpend === undefined ? {} : { spendCents: initialSpend }),
    ...(spendCurrency === undefined ? {} : { spendCurrency })
  }
}

const toCompletedOrderItem = (aggregate: ItemAggregate): NormalizedCompletedOrderItem => ({
  itemKey: aggregate.itemKey,
  orderCount: aggregate.orderIds.size,
  orderIds: Array.from(aggregate.orderIds),
  totalQuantity: aggregate.totalQuantity,
  ...(aggregate.brand === undefined ? {} : { brand: aggregate.brand }),
  lastOrderId: aggregate.lastOrderId,
  lastOrderedAt: aggregate.lastOrderedAt,
  ...(aggregate.name === undefined ? {} : { name: aggregate.name }),
  ...(aggregate.productId === undefined ? {} : { productId: aggregate.productId }),
  ...(aggregate.retailerProductId === undefined ? {} : { retailerProductId: aggregate.retailerProductId }),
  ...(aggregate.spendCents === undefined || aggregate.spendCurrency === undefined
    ? {}
    : { totalSpend: { amount: formatCents(aggregate.spendCents), currency: aggregate.spendCurrency } })
})

export const getOrderDetails = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetOrderDetailsResult, GetOrderDetailsError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeOrderDetailsRequest(input)), (request) =>
    Effect.flatMap(requestVoilaJson(RawDecoratedOrderResponseSchema, session, request, cookieJarPort), (result) =>
      Effect.map(Effect.fromResult(normalizeOrderDetailsResponse(result.value, request.orderId)), (value) => ({
        session: result.session,
        value
      }))
    )
  )

const makeOrderPageInput = (
  input: CompletedOrderItemsInput,
  pageToken: string | undefined,
  remainingOrders: number
) => ({
  pageSize: Math.min(input.pageSize ?? input.maxOrders, remainingOrders),
  ...(pageToken === undefined ? {} : { pageToken })
})

/**
 * Where the order scan has got to: the orders that matched the window, how many
 * were looked at to find them, and the page the next request would ask for.
 * `done` is carried because the scan's stop condition is about the page that
 * just arrived — Voila repeating a page token is how a scan ends without a
 * next page, and that is only visible by comparing against the token used.
 */
interface OrderScanState {
  readonly done: boolean
  readonly matchingOrders: ReadonlyArray<NormalizedCompletedOrder>
  readonly ordersScanned: number
  readonly pageToken: string | undefined
  readonly pagination: NormalizedCompletedOrderItemsResult["pagination"]
  readonly session: SessionSnapshot
}

const runOrderScan = (
  initial: OrderScanState,
  body: (state: OrderScanState) => Effect.Effect<OrderScanState, GetCompletedOrdersError, VoilaTransport>,
  shouldContinue: (state: OrderScanState) => boolean
): Effect.Effect<OrderScanState, GetCompletedOrdersError, VoilaTransport> => {
  const loop = (state: OrderScanState): Effect.Effect<OrderScanState, GetCompletedOrdersError, VoilaTransport> =>
    shouldContinue(state) ? Effect.flatMap(body(state), loop) : Effect.succeed(state)

  return loop(initial)
}

const scanOrderPage = (
  state: OrderScanState,
  input: CompletedOrderItemsInput,
  cookieJarPort?: CookieJarPort
): Effect.Effect<OrderScanState, GetCompletedOrdersError, VoilaTransport> =>
  Effect.map(
    getCompletedOrders(
      state.session,
      makeOrderPageInput(input, state.pageToken, input.maxOrders - state.matchingOrders.length),
      cookieJarPort
    ),
    (orders) => {
      const matchingOrders = orders.value.orders.reduce<ReadonlyArray<NormalizedCompletedOrder>>(
        (matched, order) =>
          matched.length < input.maxOrders && isInRange(order, input) ? [...matched, order] : matched,
        state.matchingOrders
      )
      const pagination = orders.value.pagination
      // a repeated token is Voila answering with the page just read: treat it
      // as the end of the scan rather than asking for it again forever
      const pageToken = pagination.nextPageToken === state.pageToken ? undefined : pagination.nextPageToken

      return {
        done: !(matchingOrders.length < input.maxOrders && pagination.hasNextPage && pageToken !== undefined),
        matchingOrders,
        ordersScanned: state.ordersScanned + orders.value.orders.length,
        pageToken,
        pagination,
        session: orders.session
      }
    }
  )

interface ItemAggregation {
  readonly aggregates: ReadonlyMap<string, ItemAggregate>
  readonly session: SessionSnapshot
}

const aggregateOrderItems = (
  state: ItemAggregation,
  order: NormalizedCompletedOrder,
  cookieJarPort?: CookieJarPort
): Effect.Effect<ItemAggregation, GetOrderDetailsError, VoilaTransport> =>
  Effect.map(getOrderDetails(state.session, { orderId: order.orderId }, cookieJarPort), (details) => {
    const aggregates = new Map(state.aggregates)

    for (const item of details.value.items.filter((detailItem) => detailItem.groupKind === receivedKind)) {
      const key = itemKeyFor(item)
      aggregates.set(key, aggregateItem(aggregates.get(key), item, order))
    }

    return { aggregates, session: details.session }
  })

const makeCompletedOrderItemsResult = (
  scan: OrderScanState,
  aggregation: ItemAggregation
): GetCompletedOrderItemsResult => {
  const items = Array.from(aggregation.aggregates.values())
    .map(toCompletedOrderItem)
    .sort((left, right) => right.totalQuantity - left.totalQuantity || left.itemKey.localeCompare(right.itemKey))

  return {
    session: aggregation.session,
    value: {
      itemCount: items.length,
      items,
      ordersMatched: scan.matchingOrders.length,
      ordersScanned: scan.ordersScanned,
      pagination: scan.pagination
    }
  }
}

export const getCompletedOrderItems = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetCompletedOrderItemsResult, GetCompletedOrderItemsError, VoilaTransport> =>
  Effect.flatMap(
    Effect.fromResult(Result.mapError(parseUnknown(CompletedOrderItemsInputSchema, input), inputInvalid)),
    (parsed) => {
      const initial: OrderScanState = {
        done: false,
        matchingOrders: [],
        ordersScanned: 0,
        pageToken: parsed.pageToken,
        pagination: { hasNextPage: false },
        session
      }

      return Effect.flatMap(
        runOrderScan(
          initial,
          (state) => scanOrderPage(state, parsed, cookieJarPort),
          (state) => !state.done
        ),
        (scan) => {
          const noAggregates: ItemAggregation = { aggregates: new Map(), session: scan.session }

          return Effect.map(
            Effect.reduce<ItemAggregation, NormalizedCompletedOrder, GetOrderDetailsError, VoilaTransport>(
              () => noAggregates,
              (aggregation, order) => aggregateOrderItems(aggregation, order, cookieJarPort)
            )(scan.matchingOrders.slice(firstOrder, parsed.maxOrders)),
            (aggregation) => makeCompletedOrderItemsResult(scan, aggregation)
          )
        }
      )
    }
  )
