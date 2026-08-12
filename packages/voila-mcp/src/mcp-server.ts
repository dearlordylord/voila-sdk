import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

import { makeMcpInputSchema } from "./mcp-input-schema.js"
import {
  ActiveShoppingContextOperationInputSchema,
  CartItemOperationInputSchema,
  CategoryProductsOperationInputSchema,
  DiscountedProductsOperationInputSchema,
  EmptyOperationInputSchema,
  OrderDetailsOperationInputSchema,
  OrderItemsOperationInputSchema,
  OrderListOperationInputSchema,
  ProductListOperationInputSchema,
  SlotListingsOperationInputSchema,
  SlotReservationOperationInputSchema
} from "./operation-schemas.js"
import {
  mcpName,
  type OperationEnvironment,
  type OperationExecutionResult,
  runVoilaOperation,
  type VoilaOperationDescriptor,
  voilaOperationDescriptors,
  type VoilaOperationName
} from "./operations.js"
import { packageVersion } from "./package-version.js"

const emptyInputSchema = makeMcpInputSchema(EmptyOperationInputSchema)
const readOnlyAnnotations: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true
}
const mutationAnnotations: ToolAnnotations = {
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false
}

const activeShoppingContextInputSchema = makeMcpInputSchema(ActiveShoppingContextOperationInputSchema)
const slotListingsInputSchema = makeMcpInputSchema(SlotListingsOperationInputSchema)
const slotReservationInputSchema = makeMcpInputSchema(SlotReservationOperationInputSchema)
const productListInputSchema = makeMcpInputSchema(ProductListOperationInputSchema)
const categoryProductsInputSchema = makeMcpInputSchema(CategoryProductsOperationInputSchema)
const discountedProductsInputSchema = makeMcpInputSchema(DiscountedProductsOperationInputSchema)
const orderListInputSchema = makeMcpInputSchema(OrderListOperationInputSchema)
const orderDetailsInputSchema = makeMcpInputSchema(OrderDetailsOperationInputSchema)
const orderItemsInputSchema = makeMcpInputSchema(OrderItemsOperationInputSchema)
const cartItemsInputSchema = makeMcpInputSchema(CartItemOperationInputSchema)

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
  version = packageVersion
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
    annotations: readOnlyAnnotations,
    description: health.description,
    inputSchema: emptyInputSchema,
    title: health.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_check_session_health", input, env)))

  server.registerTool("voila_get_active_shopping_context", {
    annotations: readOnlyAnnotations,
    description: activeShoppingContext.description,
    inputSchema: activeShoppingContextInputSchema,
    title: activeShoppingContext.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_active_shopping_context", input, env)))

  server.registerTool("voila_get_slot_listings", {
    annotations: readOnlyAnnotations,
    description: slotListings.description,
    inputSchema: slotListingsInputSchema,
    title: slotListings.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_slot_listings", input, env)))

  server.registerTool("voila_reserve_slot", {
    annotations: mutationAnnotations,
    description: reserveSlot.description,
    inputSchema: slotReservationInputSchema,
    title: reserveSlot.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_reserve_slot", input, env)))

  server.registerTool("voila_search_products", {
    annotations: readOnlyAnnotations,
    description: search.description,
    inputSchema: productListInputSchema,
    title: search.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_search_products", input, env)))

  server.registerTool("voila_get_category_products", {
    annotations: readOnlyAnnotations,
    description: categoryProducts.description,
    inputSchema: categoryProductsInputSchema,
    title: categoryProducts.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_category_products", input, env)))

  server.registerTool("voila_get_discounted_products", {
    annotations: readOnlyAnnotations,
    description: discountedProducts.description,
    inputSchema: discountedProductsInputSchema,
    title: discountedProducts.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_discounted_products", input, env)))

  server.registerTool("voila_get_completed_orders", {
    annotations: readOnlyAnnotations,
    description: completedOrders.description,
    inputSchema: orderListInputSchema,
    title: completedOrders.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_completed_orders", input, env)))

  server.registerTool("voila_get_order_details", {
    annotations: readOnlyAnnotations,
    description: orderDetails.description,
    inputSchema: orderDetailsInputSchema,
    title: orderDetails.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_order_details", input, env)))

  server.registerTool("voila_get_completed_order_items", {
    annotations: readOnlyAnnotations,
    description: completedOrderItems.description,
    inputSchema: orderItemsInputSchema,
    title: completedOrderItems.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_completed_order_items", input, env)))

  server.registerTool("voila_get_cart", {
    annotations: readOnlyAnnotations,
    description: cart.description,
    inputSchema: emptyInputSchema,
    title: cart.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_cart", input, env)))

  server.registerTool("voila_add_cart_items", {
    annotations: mutationAnnotations,
    description: addCart.description,
    inputSchema: cartItemsInputSchema,
    title: addCart.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_add_cart_items", input, env)))

  server.registerTool("voila_remove_cart_items", {
    annotations: mutationAnnotations,
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
