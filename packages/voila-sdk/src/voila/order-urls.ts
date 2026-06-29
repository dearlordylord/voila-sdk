import { Either } from "effect"

import { parseUnknown } from "../domain/parse.js"
import {
  type CompletedOrdersInput,
  CompletedOrdersInputSchema,
  type OrderDetailsInput,
  OrderDetailsInputSchema
} from "../domain/schemas/index.js"
import { VOILA_BASE_URL } from "./urls.js"

const COMPLETED_ORDERS_GRAPHQL_PATH = "/graphql"
const ORDER_PATH_PREFIX = "/api/order/v6/orders/"

export const COMPLETED_ORDERS_QUERY = `query GetCompletedOrders($first: Int!, $after: String) {
  completedOrders(first: $first, after: $after) {
    retentionPeriod
    pageInfo {
      endCursor
      hasNextPage
    }
    edges {
      node {
        orderId
        status
        region {
          retailerRegionId
          regionId
        }
        prices {
          total {
            currency
            amount
          }
        }
        recurringOrderDefinition {
          name
        }
        slot {
          __typename
          ... on InternalOrderSlot {
            start
            end
            type
            shippingGroupType
            carrier {
              carrierId
            }
            externalLocker {
              externalLockerId
            }
            deliveryDestination {
              deliveryMethod
              name
              address {
                timeZone
              }
            }
          }
          ... on ImportedOrderSlot {
            start
            end
            name
            timeZone
          }
        }
      }
    }
  }
}`

export interface CompletedOrdersRequest {
  readonly body: string
  readonly method: "POST"
  readonly url: URL
}

export type CompletedOrdersRequestError = {
  readonly _tag: "CompletedOrdersInputInvalid"
  readonly message: string
}

export interface OrderDetailsRequest {
  readonly method: "GET"
  readonly orderId: string
  readonly url: URL
}

export type OrderDetailsRequestError = {
  readonly _tag: "OrderDetailsInputInvalid"
  readonly message: string
}

const completedOrdersInputInvalid = (): CompletedOrdersRequestError => ({
  _tag: "CompletedOrdersInputInvalid",
  message: "Completed orders request input does not match the SDK schema"
})

const orderDetailsInputInvalid = (): OrderDetailsRequestError => ({
  _tag: "OrderDetailsInputInvalid",
  message: "Order details request input does not match the SDK schema"
})

const makeVariables = (input: CompletedOrdersInput) => ({
  ...(input.pageToken === undefined ? {} : { after: input.pageToken }),
  first: input.pageSize
})

export const makeCompletedOrdersRequest = (
  input: unknown = {}
): Either.Either<CompletedOrdersRequest, CompletedOrdersRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(CompletedOrdersInputSchema, input), completedOrdersInputInvalid),
    (completedOrdersInput) => ({
      body: JSON.stringify({
        operationName: "GetCompletedOrders",
        query: COMPLETED_ORDERS_QUERY,
        variables: makeVariables(completedOrdersInput)
      }),
      method: "POST",
      url: new URL(COMPLETED_ORDERS_GRAPHQL_PATH, VOILA_BASE_URL)
    })
  )

const makeOrderDetailsUrl = (input: OrderDetailsInput): URL =>
  new URL(`${ORDER_PATH_PREFIX}${encodeURIComponent(input.orderId)}/decorated`, VOILA_BASE_URL)

export const makeOrderDetailsRequest = (
  input: unknown
): Either.Either<OrderDetailsRequest, OrderDetailsRequestError> =>
  Either.map(
    Either.mapLeft(parseUnknown(OrderDetailsInputSchema, input), orderDetailsInputInvalid),
    (orderDetailsInput) => ({
      method: "GET",
      orderId: orderDetailsInput.orderId,
      url: makeOrderDetailsUrl(orderDetailsInput)
    })
  )
