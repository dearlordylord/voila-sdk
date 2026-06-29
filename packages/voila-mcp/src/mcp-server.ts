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

const productListInputSchema = {
  pageSize: z.number().int().min(1).max(24).optional(),
  pageToken: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1)
}

const categoryProductsInputSchema = {
  categoryId: z.string().trim().min(1),
  pageSize: z.number().int().min(1).max(24).optional(),
  pageToken: z.string().trim().min(1).optional()
}

const orderListInputSchema = {
  pageSize: z.number().int().min(1).max(50).optional(),
  pageToken: z.string().trim().min(1).optional()
}

const cartItemsInputSchema = {
  items: z.array(z.object({
    productId: z.string().trim().min(1),
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
  const search = descriptorFor("voila_search_products")
  const categoryProducts = descriptorFor("voila_get_category_products")
  const completedOrders = descriptorFor("voila_get_completed_orders")
  const cart = descriptorFor("voila_get_cart")
  const addCart = descriptorFor("voila_add_cart_items")
  const removeCart = descriptorFor("voila_remove_cart_items")

  server.registerTool("voila_check_session_health", {
    description: health.description,
    inputSchema: emptyInputSchema,
    title: health.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_check_session_health", input, env)))

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

  server.registerTool("voila_get_completed_orders", {
    description: completedOrders.description,
    inputSchema: orderListInputSchema,
    title: completedOrders.title
  }, async (input) => makeToolResult(await runVoilaOperation("voila_get_completed_orders", input, env)))

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
