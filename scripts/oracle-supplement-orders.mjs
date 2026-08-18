const ordersResponse = {
  data: {
    completedOrders: {
      edges: [
        {
          node: {
            orderId: "oracle-order-1",
            prices: { total: { amount: "42.50", currency: "CAD" } },
            recurringOrderDefinition: { name: "Oracle staples" },
            region: { regionId: "oracle-region", retailerRegionId: "oracle-retailer-region" },
            slot: {
              __typename: "InternalOrderSlot",
              carrier: { carrierId: "oracle-carrier" },
              deliveryDestination: {
                address: { timeZone: "America/Montreal" },
                deliveryMethod: "HOME_DELIVERY",
                name: "Oracle Home"
              },
              end: "2026-06-20T11:00:00-04:00",
              externalLocker: null,
              shippingGroupType: "HOME_DELIVERY",
              start: "2026-06-20T10:00:00-04:00",
              type: "STANDARD"
            },
            status: "DELIVERED"
          }
        },
        {
          node: {
            orderId: "oracle-order-2",
            prices: { total: { amount: "18.20", currency: "CAD" } },
            recurringOrderDefinition: null,
            region: { regionId: "oracle-region", retailerRegionId: "oracle-retailer-region" },
            slot: {
              __typename: "ImportedOrderSlot",
              end: "2026-05-15T14:00:00-04:00",
              name: "Oracle Imported Address",
              start: "2026-05-15T13:00:00-04:00",
              timeZone: "America/Montreal"
            },
            status: "DELIVERED"
          }
        }
      ],
      pageInfo: { endCursor: "oracle-next-order-cursor", hasNextPage: true },
      retentionPeriod: "ONE_YEAR"
    }
  }
}

const detailsResponse = {
  entities: {
    order: {
      "oracle-order-1": {
        items: [{ finalPrice: { amount: "9.98", currency: "CAD" }, product: "oracle-product-1", quantity: 2 }],
        missingItems: [{ product: "oracle-product-2", quantity: 1 }],
        orderId: "oracle-order-1",
        orderReference: "oracle-reference-1",
        prices: { total: { amount: "42.50", currency: "CAD" } },
        region: { regionId: "oracle-region", retailerRegionId: "oracle-retailer-region" },
        slot: { end: "2026-06-20T11:00:00-04:00", start: "2026-06-20T10:00:00-04:00", timeZone: "America/Montreal" },
        status: "DELIVERED",
        substitutedItems: [
          { product: "oracle-product-3", quantity: 1, substitutes: [{ product: "oracle-product-4", quantity: 1 }] }
        ]
      }
    },
    product: {
      "oracle-product-1": {
        brand: "Oracle Brand",
        isInCurrentCatalog: true,
        name: "Oracle Milk",
        price: { current: { amount: "4.99", currency: "CAD" } },
        productId: "oracle-product-1",
        retailerProductId: "oracle-retailer-product-1",
        seller: { id: "oracle-seller", name: "Oracle Seller" }
      },
      "oracle-product-2": { name: "Oracle Bread", productId: "oracle-product-2" },
      "oracle-product-3": { name: "Oracle Apples", productId: "oracle-product-3" },
      "oracle-product-4": { name: "Oracle Substitute Apples", productId: "oracle-product-4" }
    }
  }
}

const outcome = (result, summarize) => {
  if (result?._tag === "Right") return { _tag: "Right", value: summarize(result.right.value) }
  if (result?._tag === "Left") return { _tag: "Left", error: { _tag: result.left?._tag ?? "UnknownFailure" } }
  if (result?._tag === "Success") return { _tag: "Right", value: summarize(result.success.value) }
  if (result?._tag === "Failure") return { _tag: "Left", error: { _tag: result.failure?._tag ?? "UnknownFailure" } }
  return { _tag: "UnknownResult" }
}

const summarizeOrders = (value) => ({
  orderIds: value.orders.map((order) => order.orderId),
  pagination: value.pagination,
  statuses: value.orders.map((order) => order.status)
})

const summarizeDetails = (value) => ({
  groupKinds: value.itemGroups.map((group) => group.kind),
  itemCount: value.items.length,
  orderId: value.orderId,
  orderReference: value.orderReference,
  status: value.status
})

const summarizeItems = (value) => ({
  itemKeys: value.items.map((item) => item.itemKey),
  itemCount: value.itemCount,
  ordersMatched: value.ordersMatched,
  ordersScanned: value.ordersScanned
})

const right = (result) =>
  result?._tag === "Right" ? result.right : result?._tag === "Success" ? result.success : undefined

const settle = (effect, program) => (effect.Effect.either ?? effect.Effect.result)(program)

const makeSession = (sdk) => {
  const jar = sdk.toughCookieJarPort.create()
  jar.setCookieSync("voila-session=oracle-order-cookie; Path=/; Secure; HttpOnly", "https://voila.ca/")
  const serialized = sdk.serializeCookieJar(jar)
  const snapshot = sdk.makeSessionSnapshot(
    {
      assetVersion: "oracle-asset",
      clientRouteId: "oracle-route",
      pageViewId: "oracle-page",
      regionId: "oracle-region"
    },
    { token: "oracle-csrf" },
    right(serialized)
  )
  return right(snapshot)
}

export const captureOrderSupplement = async ({ effect, sdk }) => {
  const session = makeSession(sdk)
  const requests = []
  const transport = effect.Layer.succeed(sdk.VoilaTransport, {
    request: (request) => {
      requests.push({
        hasCookie: typeof request.headers.cookie === "string",
        hasCsrf: typeof request.headers["X-CSRF-TOKEN"] === "string",
        method: request.method,
        path: request.url.pathname
      })
      return effect.Effect.succeed({
        body: JSON.stringify(request.url.pathname === "/graphql" ? ordersResponse : detailsResponse),
        headers: {},
        status: 200
      })
    }
  })
  const run = (operation) => effect.Effect.runPromise(settle(effect, effect.Effect.provide(operation, transport)))
  const orders = await run(sdk.getCompletedOrders(session, { pageSize: 2, pageToken: "oracle-previous-cursor" }))
  const details = await run(sdk.getOrderDetails(session, { orderId: "oracle-order-1" }))
  const items = await run(
    sdk.getCompletedOrderItems(session, { fromDate: "2026-06-01", maxOrders: 2, pageSize: 2, toDate: "2026-06-30" })
  )
  return {
    completedOrderItems: outcome(items, summarizeItems),
    completedOrders: outcome(orders, summarizeOrders),
    orderDetails: outcome(details, summarizeDetails),
    requests
  }
}
