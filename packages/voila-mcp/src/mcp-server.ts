import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import {
  mcpName,
  type OperationEnvironment,
  type OperationExecutionResult,
  runVoilaOperation,
  type VoilaOperationDescriptor,
  voilaOperationDescriptors,
  type VoilaOperationName
} from "./operations.js"

const emptyInputSchema = {}
const isoDateInput = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
const nonEmptyInput = z.string().trim().min(1)

const activeShoppingContextInputSchema = {
  regionId: nonEmptyInput.optional()
}

const slotListingsInputSchema = {
  deliveryDestinationId: nonEmptyInput,
  displayConfiguration: z.enum(["DELIVERY_METHOD", "CARRIER"]).optional(),
  numberOfDays: z.number().int().positive().optional(),
  regionId: nonEmptyInput,
  shippingGroupType: nonEmptyInput.optional(),
  viewingLocation: nonEmptyInput.optional()
}

const slotReservationInputSchema = {
  allowReservationOverwrite: z.literal(true),
  confirmSlotReservation: z.literal(true),
  deliveryDestinationId: nonEmptyInput,
  externalAddress: z.record(z.string(), z.unknown()).optional(),
  regionId: nonEmptyInput,
  slotId: nonEmptyInput
}

const productListInputSchema = {
  pageSize: z.number().int().min(1).max(24).optional(),
  pageToken: nonEmptyInput.optional(),
  query: nonEmptyInput
}

const categoryProductsInputSchema = {
  categoryId: nonEmptyInput,
  pageSize: z.number().int().min(1).max(24).optional(),
  pageToken: nonEmptyInput.optional()
}

const discountedProductsInputSchema = {
  categoryId: nonEmptyInput.optional(),
  minSavingsAmount: z.number().nonnegative().optional(),
  minSavingsPercent: z.number().nonnegative().optional(),
  pageSize: z.number().int().min(1).max(24).optional(),
  pageToken: nonEmptyInput.optional(),
  query: nonEmptyInput.optional(),
  retailerCategoryId: nonEmptyInput.optional(),
  sort: z.enum(["best-percent", "best-amount", "price-asc"]).optional()
}

const orderListInputSchema = {
  pageSize: z.number().int().min(1).max(50).optional(),
  pageToken: nonEmptyInput.optional()
}

const orderDetailsInputSchema = {
  orderId: nonEmptyInput
}

const orderItemsInputSchema = {
  fromDate: isoDateInput.optional(),
  maxOrders: z.number().int().min(1).max(50).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  pageToken: nonEmptyInput.optional(),
  toDate: isoDateInput.optional()
}

const cartItemsInputSchema = {
  items: z.array(z.object({
    productId: nonEmptyInput,
    quantity: z.number().int().positive()
  })).min(1)
}

const stringifyResult = (result: OperationExecutionResult): string => JSON.stringify(result, undefined, 2)

const makeToolResult = (result: OperationExecutionResult) => ({
  content: [{
    text: stringifyResult(result),
    type: "text" as const
  }],
  isError: !result.ok
})

const descriptorFor = (name: VoilaOperationName): VoilaOperationDescriptor => {
  const descriptor = voilaOperationDescriptors.find((operation) => operation.name === name)

  if (descriptor === undefined) {
    throw new Error(`Missing Voila operation descriptor for ${name}`)
  }

  return descriptor
}

export const createVoilaMcpServer = (
  env: OperationEnvironment,
  version = "0.1.0"
): McpServer => {
  const server = new McpServer({
    name: mcpName,
    version
  })
  const health = descriptorFor("voila_check_session_health")
  const activeShoppingContext = descriptorFor("voila_get_active_shopping_context")
  const slotListings = descriptorFor("voila_get_slot_listings")
  const reserveSlot = descriptorFor("voila_reserve_slot")
  const search = descriptorFor("voila_search_products")
  const categoryProducts = descriptorFor("voila_get_category_products")
  const discountedProducts = descriptorFor("voila_get_discounted_products")
  const completedOrders = descriptorFor("voila_get_completed_orders")
  const orderDetails = descriptorFor("voila_get_order_details")
  const completedOrderItems = descriptorFor("voila_get_completed_order_items")
  const cart = descriptorFor("voila_get_cart")
  const addCart = descriptorFor("voila_add_cart_items")
  const removeCart = descriptorFor("voila_remove_cart_items")

  server.registerTool("voila_check_session_health", {
    description: health.description,
    inputSchema: emptyInputSchema,
    title: health.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_check_session_health", input, env)))

  server.registerTool("voila_get_active_shopping_context", {
    description: activeShoppingContext.description,
    inputSchema: activeShoppingContextInputSchema,
    title: activeShoppingContext.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_active_shopping_context", input, env)))

  server.registerTool("voila_get_slot_listings", {
    description: slotListings.description,
    inputSchema: slotListingsInputSchema,
    title: slotListings.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_slot_listings", input, env)))

  server.registerTool("voila_reserve_slot", {
    description: reserveSlot.description,
    inputSchema: slotReservationInputSchema,
    title: reserveSlot.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_reserve_slot", input, env)))

  server.registerTool("voila_search_products", {
    description: search.description,
    inputSchema: productListInputSchema,
    title: search.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_search_products", input, env)))

  server.registerTool("voila_get_category_products", {
    description: categoryProducts.description,
    inputSchema: categoryProductsInputSchema,
    title: categoryProducts.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_category_products", input, env)))

  server.registerTool("voila_get_discounted_products", {
    description: discountedProducts.description,
    inputSchema: discountedProductsInputSchema,
    title: discountedProducts.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_discounted_products", input, env)))

  server.registerTool("voila_get_completed_orders", {
    description: completedOrders.description,
    inputSchema: orderListInputSchema,
    title: completedOrders.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_completed_orders", input, env)))

  server.registerTool("voila_get_order_details", {
    description: orderDetails.description,
    inputSchema: orderDetailsInputSchema,
    title: orderDetails.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_order_details", input, env)))

  server.registerTool("voila_get_completed_order_items", {
    description: completedOrderItems.description,
    inputSchema: orderItemsInputSchema,
    title: completedOrderItems.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_completed_order_items", input, env)))

  server.registerTool("voila_get_cart", {
    description: cart.description,
    inputSchema: emptyInputSchema,
    title: cart.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_cart", input, env)))

  server.registerTool("voila_add_cart_items", {
    description: addCart.description,
    inputSchema: cartItemsInputSchema,
    title: addCart.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_add_cart_items", input, env)))

  server.registerTool("voila_remove_cart_items", {
    description: removeCart.description,
    inputSchema: cartItemsInputSchema,
    title: removeCart.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_remove_cart_items", input, env)))

  return server
}

export const startStdioServer = async (
  env: OperationEnvironment,
  version?: string
): Promise<void> => {
  const server = createVoilaMcpServer(env, version)
  const transport = new StdioServerTransport()

  await server.connect(transport)
}

export const isVoilaOperationName = (name: string): name is VoilaOperationName =>
  voilaOperationDescriptors.some((operation) => operation.name === name)
