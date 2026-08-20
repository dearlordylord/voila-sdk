import { Effect, Match, Result } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  NormalizedCompletedOrdersResultSchema,
  type NormalizedCompletedOrder,
  type NormalizedCompletedOrdersResult,
  type RawCompletedOrderNode,
  type RawCompletedOrdersConnection,
  type RawCompletedOrdersGraphqlResponse,
  RawCompletedOrdersGraphqlResponseSchema,
  type RawCompletedOrderSlot,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CompletedOrdersRequestError } from "./order-urls.js"
import { makeCompletedOrdersRequest } from "./order-urls.js"
import type { CookieJarPort } from "./session-snapshot.js"
import type { VoilaTransport } from "./transport.js"

export type CompletedOrdersGraphqlError = { readonly _tag: "CompletedOrdersGraphqlError"; readonly message: string }

export type CompletedOrdersUnavailableError = { readonly _tag: "CompletedOrdersUnavailable"; readonly message: string }

export type CompletedOrdersNormalizationError = {
  readonly _tag: "CompletedOrdersNormalizationError"
  readonly message: string
}

export type GetCompletedOrdersError =
  | CompletedOrdersGraphqlError
  | CompletedOrdersNormalizationError
  | CompletedOrdersRequestError
  | CompletedOrdersUnavailableError
  | VoilaSdkError

export type GetCompletedOrdersResult = VoilaJsonResult<NormalizedCompletedOrdersResult>

const HOME_DELIVERY = "HOME_DELIVERY"
const STANDARD_SLOT = "STANDARD"

const normalizeSlot = (slot: RawCompletedOrderSlot) =>
  Match.value(slot).pipe(
    Match.when({ __typename: "ImportedOrderSlot" }, (imported) => ({
      addressNickName: imported.name,
      dates: { deliveryEndDate: imported.end, deliveryStartDate: imported.start, timeZoneId: imported.timeZone },
      deliveryMethod: HOME_DELIVERY,
      slotType: STANDARD_SLOT
    })),
    Match.when({ __typename: "InternalOrderSlot" }, (internal) => ({
      addressNickName: internal.deliveryDestination.name,
      ...(internal.carrier === undefined || internal.carrier === null ? {} : { carrierId: internal.carrier.carrierId }),
      dates: {
        deliveryEndDate: internal.end,
        deliveryStartDate: internal.start,
        timeZoneId: internal.deliveryDestination.address.timeZone
      },
      deliveryMethod: internal.deliveryDestination.deliveryMethod,
      ...(internal.externalLocker === undefined || internal.externalLocker === null
        ? {}
        : { externalAddress: { externalCollectionPointId: internal.externalLocker.externalLockerId } }),
      ...(internal.shippingGroupType === undefined ? {} : { shippingGroupType: internal.shippingGroupType }),
      slotType: internal.type
    })),
    Match.exhaustive
  )

const normalizeCompletedOrder = (order: RawCompletedOrderNode): NormalizedCompletedOrder => ({
  ...normalizeSlot(order.slot),
  orderId: order.orderId,
  orderTotals: { totalPrice: order.prices.total },
  ...(order.recurringOrderDefinition === undefined || order.recurringOrderDefinition === null
    ? {}
    : { recurringShoppingDefinition: { name: order.recurringOrderDefinition.name } }),
  regionId: order.region.regionId,
  retailerRegionId: order.region.retailerRegionId,
  status: order.status
})

const projectCompletedOrdersResponse = (connection: RawCompletedOrdersConnection) => {
  const orders = connection.edges.flatMap((edge) =>
    edge?.node === undefined || edge.node === null ? [] : [normalizeCompletedOrder(edge.node)]
  )

  return {
    orders,
    pagination: {
      hasNextPage: connection.pageInfo.hasNextPage,
      ...(connection.pageInfo.endCursor === null ? {} : { nextPageToken: connection.pageInfo.endCursor }),
      ...(connection.retentionPeriod === undefined ? {} : { retentionPeriod: connection.retentionPeriod })
    }
  }
}

export const normalizeCompletedOrdersResponse = (
  connection: RawCompletedOrdersConnection
): Result.Result<NormalizedCompletedOrdersResult, CompletedOrdersNormalizationError> =>
  Result.mapError(
    parseUnknown(NormalizedCompletedOrdersResultSchema, projectCompletedOrdersResponse(connection)),
    completedOrdersNormalizationError
  )

const graphqlError = (): CompletedOrdersGraphqlError => ({
  _tag: "CompletedOrdersGraphqlError",
  message: "Voila completed orders returned a GraphQL error; account login may be required"
})

const completedOrdersUnavailable = (): CompletedOrdersUnavailableError => ({
  _tag: "CompletedOrdersUnavailable",
  message: "Voila completed orders are unavailable for the current session"
})

const completedOrdersNormalizationError = (): CompletedOrdersNormalizationError => ({
  _tag: "CompletedOrdersNormalizationError",
  message: "Voila completed orders could not be normalized"
})

const getCompletedOrdersConnection = (
  response: RawCompletedOrdersGraphqlResponse
): Result.Result<RawCompletedOrdersConnection, CompletedOrdersGraphqlError | CompletedOrdersUnavailableError> => {
  if (response.errors !== undefined && response.errors.length > 0) {
    return Result.fail(graphqlError())
  }

  if (response.data === undefined || response.data === null || response.data.completedOrders === null) {
    return Result.fail(completedOrdersUnavailable())
  }

  return Result.succeed(response.data.completedOrders)
}

export const getCompletedOrders = (
  session: SessionSnapshot,
  input: unknown,
  cookieJarPort?: CookieJarPort
): Effect.Effect<GetCompletedOrdersResult, GetCompletedOrdersError, VoilaTransport> =>
  Effect.flatMap(Effect.fromResult(makeCompletedOrdersRequest(input)), (request) =>
    Effect.flatMap(
      requestVoilaJson(RawCompletedOrdersGraphqlResponseSchema, session, request, cookieJarPort),
      (result) =>
        Effect.flatMap(Effect.fromResult(getCompletedOrdersConnection(result.value)), (connection) =>
          Effect.map(Effect.fromResult(normalizeCompletedOrdersResponse(connection)), (value) => ({
            session: result.session,
            value
          }))
        )
    )
  )
