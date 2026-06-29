import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { makeCartQuantityDelta } from "../../src/domain/cart.js"
import { makeCheckoutSummaryRequest, makeSlotListingRequest, makeSlotReservationRequest } from "../../src/index.js"
import type { CartViewRequest, DeliveryDestinationsRequest, SearchRequest } from "../../src/voila/urls.js"
import {
  makeActiveShoppingContextRequest,
  makeApplyQuantityRequest,
  makeCartViewRequest,
  makeDeliveryContextPreviewRequest,
  makeDeliveryDestinationRequest,
  makeDeliveryDestinationsRequest,
  makeDeliveryPropositionDetailsRequest,
  makeSearchRequest,
  makeSetActiveCartPropositionRequest,
  makeSetActiveDeliveryDestinationRequest
} from "../../src/voila/urls.js"

const expectSearchRequest = (request: SearchRequest): SearchRequest => request
const expectCartViewRequest = (request: CartViewRequest): CartViewRequest => request
const expectDeliveryDestinationsRequest = (
  request: DeliveryDestinationsRequest
): DeliveryDestinationsRequest => request
const productUuid = "b952bad2-3d09-4b7f-831a-87ad31eaad3f"

describe("Voila URLs", () => {
  it("builds product search URLs with web search parameters", () => {
    const request = makeSearchRequest({
      pageSize: 24,
      query: "milk"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      const searchRequest = expectSearchRequest(request.right)

      expect(searchRequest.url.origin).toBe("https://voila.ca")
      expect(searchRequest.url.pathname).toBe("/api/webproductpagews/v6/product-pages/search")
      expect(searchRequest.url.searchParams.get("q")).toBe("milk")
      expect(searchRequest.url.searchParams.get("tag")).toBe("web")
      expect(searchRequest.url.searchParams.get("includeAdditionalPageInfo")).toBe("true")
      expect(searchRequest.url.searchParams.get("maxPageSize")).toBe("24")
    }
  })

  it("builds apply quantity requests", () => {
    const delta = makeCartQuantityDelta(productUuid, 1)

    expect(Either.isRight(delta)).toBe(true)

    if (Either.isRight(delta)) {
      const request = makeApplyQuantityRequest([
        delta.right
      ])

      expect(Either.isRight(request)).toBe(true)

      if (Either.isRight(request)) {
        expect(request.right.method).toBe("POST")
        expect(request.right.url.pathname).toBe("/api/cart/v1/carts/active/apply-quantity")
        expect(request.right.url.searchParams.get("cartProductSorting")).toBe("CATEGORIES")
        expect(request.right.body).toBe(`[{\"productId\":\"${productUuid}\",\"quantity\":1}]`)
      }
    }
  })

  it("rejects invalid apply quantity request bodies before serialization", () => {
    for (
      const input of [
        [],
        [{
          productId: "243255EA",
          quantity: 1
        }],
        [{
          productId: productUuid,
          quantity: 0
        }],
        [{
          productId: productUuid,
          quantity: Number.NaN
        }]
      ]
    ) {
      const request = makeApplyQuantityRequest(input)

      expect(Either.isLeft(request)).toBe(true)

      if (Either.isLeft(request)) {
        expect(request.left._tag).toBe("CartQuantityInputInvalid")
      }
    }
  })

  it("builds cart view requests", () => {
    const request = expectCartViewRequest(makeCartViewRequest())

    expect(request.method).toBe("GET")
    expect(request.url.origin).toBe("https://voila.ca")
    expect(request.url.pathname).toBe("/api/cart/v2/carts/active/cart-view")
    expect(request.url.search).toBe("")
  })

  it("builds read-only checkout summary requests", () => {
    const request = makeCheckoutSummaryRequest({
      appliedPaymentCheckId: "payment-check-id",
      fetchAllocatedPaymentChecks: true
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("GET")
      expect(request.right.url.pathname).toBe("/api/cart/v1/carts/active/checkout-summary")
      expect(request.right.url.searchParams.get("fetchAllocatedPaymentChecks")).toBe("true")
      expect(request.right.url.searchParams.get("paymentCheckId")).toBe("payment-check-id")
    }
  })

  it("builds delivery destination list requests with a home-delivery default", () => {
    const request = makeDeliveryDestinationsRequest()

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      const deliveryRequest = expectDeliveryDestinationsRequest(request.right)

      expect(deliveryRequest.method).toBe("GET")
      expect(deliveryRequest.url.origin).toBe("https://voila.ca")
      expect(deliveryRequest.url.pathname).toBe("/api/ecomdeliverydestinations/v4/delivery-addresses")
      expect(deliveryRequest.url.searchParams.get("deliveryMethod")).toBe("HOME_DELIVERY")
    }
  })

  it("builds delivery destination list requests for collection destinations", () => {
    const request = makeDeliveryDestinationsRequest({
      deliveryMethod: "CUSTOMER_COLLECTION"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.url.searchParams.get("deliveryMethod")).toBe("CUSTOMER_COLLECTION")
    }
  })

  it("rejects invalid delivery destination list inputs", () => {
    const request = makeDeliveryDestinationsRequest({
      deliveryMethod: "PICKUP"
    })

    expect(Either.isLeft(request)).toBe(true)

    if (Either.isLeft(request)) {
      expect(request.left._tag).toBe("DeliveryDestinationsInputInvalid")
    }
  })

  it("builds single delivery destination requests", () => {
    const request = makeDeliveryDestinationRequest({
      deliveryDestinationId: "destination/id with spaces"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("GET")
      expect(request.right.url.pathname).toBe(
        "/api/ecomdeliverydestinations/v4/delivery-addresses/destination%2Fid%20with%20spaces"
      )
    }
  })

  it("builds active shopping context requests with optional region scope", () => {
    const request = makeActiveShoppingContextRequest({
      regionId: "region-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("GET")
      expect(request.right.url.pathname).toBe("/api/customersessions/v2/sessions/active")
      expect(request.right.url.searchParams.get("regionId")).toBe("region-id")
    }
  })

  it("builds delivery proposition details requests", () => {
    const request = makeDeliveryPropositionDetailsRequest({
      deliveryDestinationId: "delivery-destination-id",
      regionId: "region-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("GET")
      expect(request.right.url.pathname).toBe("/api/ecomdeliverydestinations/v1/propositions")
      expect(request.right.url.searchParams.get("deliveryDestinationId")).toBe("delivery-destination-id")
      expect(request.right.url.searchParams.get("regionId")).toBe("region-id")
    }
  })

  it("builds delivery context preview requests", () => {
    const request = makeDeliveryContextPreviewRequest({
      deliveryDestinationId: "delivery-destination-id",
      destinationRegionId: "region-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("POST")
      expect(request.right.url.pathname).toBe("/api/customersessions/v2/sessions/proposition")
      expect(request.right.body).toBe(JSON.stringify({
        deliveryDestinationId: "delivery-destination-id",
        destinationRegionId: "region-id"
      }))
    }
  })

  it("builds active delivery destination update requests", () => {
    const request = makeSetActiveDeliveryDestinationRequest({
      customerId: "customer-id",
      deliveryDestinationId: "delivery-destination-id",
      regionId: "region-id",
      visitorId: "visitor-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("PUT")
      expect(request.right.url.pathname).toBe("/api/customersessions/v2/sessions/active")
      expect(request.right.headers).toEqual({
        "customer-id": "customer-id",
        "visitor-id": "visitor-id"
      })
      expect(request.right.body).toBe(JSON.stringify({
        deliveryDestinationId: "delivery-destination-id",
        regionId: "region-id"
      }))
    }
  })

  it("builds active cart proposition update requests", () => {
    const request = makeSetActiveCartPropositionRequest({
      destinationCartPropositionId: "destination-cart-proposition-id",
      originCartPropositionId: "origin-cart-proposition-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("POST")
      expect(request.right.url.pathname).toBe("/api/customersessions/v2/sessions/active")
      expect(request.right.headers).toBeUndefined()
      expect(request.right.body).toBe(JSON.stringify({
        destinationCartPropositionId: "destination-cart-proposition-id",
        originCartPropositionId: "origin-cart-proposition-id"
      }))
    }
  })

  it("builds read-only slot listing requests", () => {
    const request = makeSlotListingRequest({
      deliveryDestinationId: "delivery-destination-id",
      numberOfDays: 3,
      regionId: "region-id",
      sessionId: "analytics-session-id",
      shippingGroupType: "HOME_DELIVERY",
      viewingLocation: "SLOT_BOOKING"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("POST")
      expect(request.right.url.pathname).toBe("/api/ecomslots/v2/slots")
      expect(JSON.parse(request.right.body)).toEqual({
        analyticsData: {
          platform: "WEB",
          sessionId: "analytics-session-id",
          viewingLocation: "SLOT_BOOKING"
        },
        deliveryDestinationId: "delivery-destination-id",
        displayConfiguration: "DELIVERY_METHOD",
        numberOfDays: 3,
        regionId: "region-id",
        shippingGroupType: "HOME_DELIVERY"
      })
    }
  })

  it("builds slot listing requests without optional analytics data", () => {
    const request = makeSlotListingRequest({
      deliveryDestinationId: "delivery-destination-id",
      regionId: "region-id",
      shippingGroupType: "HOME_DELIVERY"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(JSON.parse(request.right.body)).toEqual({
        deliveryDestinationId: "delivery-destination-id",
        displayConfiguration: "DELIVERY_METHOD",
        regionId: "region-id",
        shippingGroupType: "HOME_DELIVERY"
      })
    }
  })

  it("builds slot analytics data without optional viewing location", () => {
    const request = makeSlotListingRequest({
      deliveryDestinationId: "delivery-destination-id",
      pageViewId: "page-view-id",
      regionId: "region-id",
      sessionId: "analytics-session-id",
      shippingGroupType: "HOME_DELIVERY"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(JSON.parse(request.right.body)).toEqual({
        analyticsData: {
          pageViewId: "page-view-id",
          platform: "WEB",
          sessionId: "analytics-session-id"
        },
        deliveryDestinationId: "delivery-destination-id",
        displayConfiguration: "DELIVERY_METHOD",
        regionId: "region-id",
        shippingGroupType: "HOME_DELIVERY"
      })
    }
  })

  it("builds explicit slot reservation requests without SDK-only guard fields", () => {
    const request = makeSlotReservationRequest({
      allowReservationOverwrite: true,
      confirmSlotReservation: true,
      deliveryDestinationId: "delivery-destination-id",
      externalAddress: {
        id: "external-address-id"
      },
      regionId: "region-id",
      slotId: "slot-id"
    })

    expect(Either.isRight(request)).toBe(true)

    if (Either.isRight(request)) {
      expect(request.right.method).toBe("POST")
      expect(request.right.url.pathname).toBe("/api/ecomslots/v1/slots/reservation")
      expect(JSON.parse(request.right.body)).toEqual({
        deliveryDestinationId: "delivery-destination-id",
        externalAddress: {
          id: "external-address-id"
        },
        regionId: "region-id",
        slotId: "slot-id"
      })
    }
  })

  it("rejects slot reservation requests without explicit mutation acknowledgements", () => {
    const request = makeSlotReservationRequest({
      deliveryDestinationId: "delivery-destination-id",
      regionId: "region-id",
      slotId: "slot-id"
    })

    expect(Either.isLeft(request)).toBe(true)

    if (Either.isLeft(request)) {
      expect(request.left._tag).toBe("SlotReservationInputInvalid")
    }
  })
})
