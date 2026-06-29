import { Either } from "effect"

import {
  type NormalizedCompletedOrder,
  type NormalizedCompletedOrdersResult,
  type RawCompletedOrderNode,
  type RawCompletedOrdersGraphqlResponse,
  RawCompletedOrdersGraphqlResponseSchema,
  type RawCompletedOrderSlot,
  type SessionSnapshot
} from "../domain/schemas/index.js"
import type { VoilaJsonResult, VoilaSdkError, VoilaTransport } from "./http-client.js"
import { requestVoilaJson } from "./http-client.js"
import type { CompletedOrdersRequestError } from "./order-urls.js"
import { makeCompletedOrdersRequest } from "./order-urls.js"
import type { CookieJarPort } from "./session-snapshot.js"

export type CompletedOrdersResponseNormalizationError = {
  readonly _tag: "CompletedOrdersResponseSchemaMismatch"
  readonly message: string
}

export type GetCompletedOrdersError = CompletedOrdersRequestError | VoilaSdkError

export type GetCompletedOrdersResult = VoilaJsonResult<NormalizedCompletedOrdersResult>

const HOME_DELIVERY = "HOME_DELIVERY"
const STANDARD_SLOT = "STANDARD"

const normalizeSlot = (slot: RawCompletedOrderSlot) => {
  switch (slot.__typename) {
    case "ImportedOrderSlot":
      return {
        addressNickName: slot.name,
        dates: {
          deliveryEndDate: slot.end,
          deliveryStartDate: slot.start,
          timeZoneId: slot.timeZone
        },
        deliveryMethod: HOME_DELIVERY,
        slotType: STANDARD_SLOT
      }
    case "InternalOrderSlot":
      return {
        addressNickName: slot.deliveryDestination.name,
        ...(slot.carrier === undefined || slot.carrier === null ? {} : { carrierId: slot.carrier.carrierId }),
        dates: {
          deliveryEndDate: slot.end,
          deliveryStartDate: slot.start,
          timeZoneId: slot.deliveryDestination.address.timeZone
        },
        deliveryMethod: slot.deliveryDestination.deliveryMethod,
        ...(slot.externalLocker === undefined || slot.externalLocker === null
          ? {}
          : {
            externalAddress: {
              externalCollectionPointId: slot.externalLocker.externalLockerId
            }
          }),
        ...(slot.shippingGroupType === undefined ? {} : { shippingGroupType: slot.shippingGroupType }),
        slotType: slot.type
      }
  }
}

const normalizeCompletedOrder = (order: RawCompletedOrderNode): NormalizedCompletedOrder => ({
  ...normalizeSlot(order.slot),
  orderId: order.orderId,
  orderTotals: {
    totalPrice: order.prices.total
  },
  ...(order.recurringOrderDefinition === undefined || order.recurringOrderDefinition === null
    ? {}
    : {
      recurringShoppingDefinition: {
        name: order.recurringOrderDefinition.name
      }
    }),
  regionId: order.region.regionId,
  retailerRegionId: order.region.retailerRegionId,
  status: order.status
})

export const normalizeCompletedOrdersResponse = (
  response: RawCompletedOrdersGraphqlResponse
): NormalizedCompletedOrdersResult => {
  const connection = response.data.completedOrders
  const orders = connection.edges.flatMap((edge) =>
    edge?.node === undefined || edge.node === null
      ? []
      : [normalizeCompletedOrder(edge.node)]
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

export const getCompletedOrders = async (
  session: SessionSnapshot,
  input: unknown,
  transport: VoilaTransport,
  cookieJarPort?: CookieJarPort
): Promise<Either.Either<GetCompletedOrdersResult, GetCompletedOrdersError>> => {
  const request = makeCompletedOrdersRequest(input)

  if (Either.isLeft(request)) {
    return Either.left(request.left)
  }

  const response = await requestVoilaJson(
    RawCompletedOrdersGraphqlResponseSchema,
    session,
    request.right,
    transport,
    cookieJarPort
  )

  return Either.map(response, (result) => ({
    session: result.session,
    value: normalizeCompletedOrdersResponse(result.value)
  }))
}
