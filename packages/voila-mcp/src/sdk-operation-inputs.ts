import type {
  ActiveShoppingContextOperationInput,
  CategoryProductsOperationInput,
  DiscountedProductsOperationInput,
  OrderDetailsOperationInput,
  OrderItemsOperationInput,
  OrderListOperationInput,
  ProductListOperationInput,
  SlotListingsOperationInput,
  SlotReservationOperationInput
} from "./operation-schemas.js"

const defaultPageSize = 12
const defaultSlotListingDays = 7
const defaultSlotListingDisplayConfiguration = "DELIVERY_METHOD"
const defaultSlotListingShippingGroupType = "HOME_DELIVERY"
const defaultSlotListingViewingLocation = "SLOT_BOOKING"

export const makeSdkSearchInput = (input: ProductListOperationInput) => ({
  pageSize: input.pageSize ?? defaultPageSize,
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
  query: input.query
})

export const makeSdkCategoryInput = (input: CategoryProductsOperationInput) => ({
  categoryId: input.categoryId,
  pageSize: input.pageSize ?? defaultPageSize,
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken })
})

export const makeSdkDiscountInput = (input: DiscountedProductsOperationInput) => ({
  ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
  ...(input.minSavingsAmount === undefined ? {} : { minSavingsAmount: input.minSavingsAmount }),
  ...(input.minSavingsPercent === undefined ? {} : { minSavingsPercent: input.minSavingsPercent }),
  pageSize: input.pageSize ?? defaultPageSize,
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
  ...(input.query === undefined ? {} : { query: input.query }),
  ...(input.retailerCategoryId === undefined ? {} : { retailerCategoryId: input.retailerCategoryId }),
  ...(input.sort === undefined ? {} : { sort: input.sort })
})

export const makeSdkActiveShoppingContextInput = (input: ActiveShoppingContextOperationInput) => ({
  ...(input.regionId === undefined ? {} : { regionId: input.regionId })
})

export const makeSdkSlotListingsInput = (input: SlotListingsOperationInput) => ({
  deliveryDestinationId: input.deliveryDestinationId,
  displayConfiguration: input.displayConfiguration ?? defaultSlotListingDisplayConfiguration,
  numberOfDays: input.numberOfDays ?? defaultSlotListingDays,
  regionId: input.regionId,
  shippingGroupType: input.shippingGroupType ?? defaultSlotListingShippingGroupType,
  viewingLocation: input.viewingLocation ?? defaultSlotListingViewingLocation
})

export const makeSdkSlotReservationInput = (input: SlotReservationOperationInput) => ({
  allowReservationOverwrite: input.allowReservationOverwrite,
  confirmSlotReservation: input.confirmSlotReservation,
  deliveryDestinationId: input.deliveryDestinationId,
  ...(input.externalAddress === undefined ? {} : { externalAddress: input.externalAddress }),
  regionId: input.regionId,
  slotId: input.slotId
})

export const makeSdkOrderListInput = (input: OrderListOperationInput) => ({
  ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken })
})

export const makeSdkOrderDetailsInput = (input: OrderDetailsOperationInput) => ({
  orderId: input.orderId
})

export const makeSdkOrderItemsInput = (input: OrderItemsOperationInput) => ({
  ...(input.fromDate === undefined ? {} : { fromDate: input.fromDate }),
  ...(input.maxOrders === undefined ? {} : { maxOrders: input.maxOrders }),
  ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  ...(input.pageToken === undefined ? {} : { pageToken: input.pageToken }),
  ...(input.toDate === undefined ? {} : { toDate: input.toDate })
})
