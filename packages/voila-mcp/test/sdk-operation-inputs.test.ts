import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ActiveShoppingContextOperationInputSchema,
  CategoryProductsOperationInputSchema,
  DiscountedProductsOperationInputSchema,
  OrderDetailsOperationInputSchema,
  OrderItemsOperationInputSchema,
  OrderListOperationInputSchema,
  ProductListOperationInputSchema,
  SlotListingsOperationInputSchema,
  SlotReservationOperationInputSchema
} from "../src/operation-schemas.js"
import {
  makeSdkActiveShoppingContextInput,
  makeSdkCategoryInput,
  makeSdkDiscountInput,
  makeSdkOrderDetailsInput,
  makeSdkOrderItemsInput,
  makeSdkOrderListInput,
  makeSdkSearchInput,
  makeSdkSlotListingsInput,
  makeSdkSlotReservationInput
} from "../src/sdk-operation-inputs.js"

describe("MCP SDK operation input mapping", () => {
  it("applies product and category defaults while preserving cursors", () => {
    expect(makeSdkSearchInput(Schema.decodeUnknownSync(ProductListOperationInputSchema)({ query: "milk" }))).toEqual({
      pageSize: 12,
      query: "milk"
    })
    expect(
      makeSdkSearchInput(
        Schema.decodeUnknownSync(ProductListOperationInputSchema)({ pageSize: 2, pageToken: "next", query: "milk" })
      )
    ).toEqual({ pageSize: 2, pageToken: "next", query: "milk" })

    expect(
      makeSdkCategoryInput(Schema.decodeUnknownSync(CategoryProductsOperationInputSchema)({ categoryId: "dairy" }))
    ).toEqual({ categoryId: "dairy", pageSize: 12 })
    expect(
      makeSdkCategoryInput(
        Schema.decodeUnknownSync(CategoryProductsOperationInputSchema)({
          categoryId: "dairy",
          pageSize: 3,
          pageToken: "next"
        })
      )
    ).toEqual({ categoryId: "dairy", pageSize: 3, pageToken: "next" })
  })

  it("maps optional discount filters without emitting absent fields", () => {
    expect(makeSdkDiscountInput(Schema.decodeUnknownSync(DiscountedProductsOperationInputSchema)({}))).toEqual({
      pageSize: 12
    })

    expect(
      makeSdkDiscountInput(
        Schema.decodeUnknownSync(DiscountedProductsOperationInputSchema)({
          categoryId: "dairy",
          minSavingsAmount: 1,
          minSavingsPercent: 10,
          pageSize: 3,
          pageToken: "next",
          query: "milk",
          retailerCategoryId: "retailer-dairy",
          sort: "best-percent"
        })
      )
    ).toEqual({
      categoryId: "dairy",
      minSavingsAmount: 1,
      minSavingsPercent: 10,
      pageSize: 3,
      pageToken: "next",
      query: "milk",
      retailerCategoryId: "retailer-dairy",
      sort: "best-percent"
    })
  })

  it("maps shopping context, slots, and reservation inputs explicitly", () => {
    expect(
      makeSdkActiveShoppingContextInput(Schema.decodeUnknownSync(ActiveShoppingContextOperationInputSchema)({}))
    ).toEqual({})
    expect(
      makeSdkActiveShoppingContextInput(
        Schema.decodeUnknownSync(ActiveShoppingContextOperationInputSchema)({ regionId: "region" })
      )
    ).toEqual({ regionId: "region" })

    expect(
      makeSdkSlotListingsInput(
        Schema.decodeUnknownSync(SlotListingsOperationInputSchema)({
          deliveryDestinationId: "destination",
          regionId: "region"
        })
      )
    ).toEqual({
      deliveryDestinationId: "destination",
      displayConfiguration: "DELIVERY_METHOD",
      numberOfDays: 7,
      regionId: "region",
      shippingGroupType: "HOME_DELIVERY",
      viewingLocation: "SLOT_BOOKING"
    })
    expect(
      makeSdkSlotListingsInput(
        Schema.decodeUnknownSync(SlotListingsOperationInputSchema)({
          deliveryDestinationId: "destination",
          displayConfiguration: "CARRIER",
          numberOfDays: 2,
          regionId: "region",
          shippingGroupType: "PICKUP",
          viewingLocation: "SEARCH"
        })
      )
    ).toEqual({
      deliveryDestinationId: "destination",
      displayConfiguration: "CARRIER",
      numberOfDays: 2,
      regionId: "region",
      shippingGroupType: "PICKUP",
      viewingLocation: "SEARCH"
    })

    expect(
      makeSdkSlotReservationInput(
        Schema.decodeUnknownSync(SlotReservationOperationInputSchema)({
          allowReservationOverwrite: true,
          confirmSlotReservation: true,
          deliveryDestinationId: "destination",
          regionId: "region",
          slotId: "slot"
        })
      )
    ).toEqual({
      allowReservationOverwrite: true,
      confirmSlotReservation: true,
      deliveryDestinationId: "destination",
      regionId: "region",
      slotId: "slot"
    })
    expect(
      makeSdkSlotReservationInput(
        Schema.decodeUnknownSync(SlotReservationOperationInputSchema)({
          allowReservationOverwrite: true,
          confirmSlotReservation: true,
          deliveryDestinationId: "destination",
          externalAddress: { city: "Montreal" },
          regionId: "region",
          slotId: "slot"
        })
      )
    ).toMatchObject({ externalAddress: { city: "Montreal" } })
  })

  it("maps order list, detail, and item filters while omitting absent options", () => {
    expect(makeSdkOrderListInput(Schema.decodeUnknownSync(OrderListOperationInputSchema)({}))).toEqual({})
    expect(
      makeSdkOrderListInput(Schema.decodeUnknownSync(OrderListOperationInputSchema)({ pageSize: 2, pageToken: "next" }))
    ).toEqual({ pageSize: 2, pageToken: "next" })

    expect(
      makeSdkOrderDetailsInput(Schema.decodeUnknownSync(OrderDetailsOperationInputSchema)({ orderId: "order" }))
    ).toEqual({ orderId: "order" })

    expect(makeSdkOrderItemsInput(Schema.decodeUnknownSync(OrderItemsOperationInputSchema)({}))).toEqual({})
    expect(
      makeSdkOrderItemsInput(
        Schema.decodeUnknownSync(OrderItemsOperationInputSchema)({
          fromDate: "2026-01-01",
          maxOrders: 2,
          pageSize: 3,
          pageToken: "next",
          toDate: "2026-01-31"
        })
      )
    ).toEqual({ fromDate: "2026-01-01", maxOrders: 2, pageSize: 3, pageToken: "next", toDate: "2026-01-31" })
  })
})
