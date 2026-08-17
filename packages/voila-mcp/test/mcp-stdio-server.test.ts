import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { describe, expect } from "vitest"

import { mcpName, type OperationEnvironment, VoilaOperations } from "../src/index.js"
import { stdioClient } from "./helpers/mcp-stdio.js"
import { unusedTransportLayer } from "./helpers/operations.js"

const testSessionFailure = "Session is unavailable in this protocol test"
const negotiatedProtocolVersion = "2025-06-18"

const inertEnvironment: OperationEnvironment = {
  session: { withSession: () => Effect.fail({ _tag: "VoilaTestSessionUnavailable", message: testSessionFailure }) },
  transport: unusedTransportLayer
}

const expectedToolNames = [
  "voila_add_cart_items",
  "voila_check_session_health",
  "voila_get_active_shopping_context",
  "voila_get_cart",
  "voila_get_category_products",
  "voila_get_completed_order_items",
  "voila_get_completed_orders",
  "voila_get_discounted_products",
  "voila_get_order_details",
  "voila_get_slot_listings",
  "voila_remove_cart_items",
  "voila_reserve_slot",
  "voila_search_products"
]

const readOnlyAnnotations = { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: true }

const mutationAnnotations = { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false }

interface ListedTool {
  readonly annotations: Readonly<Record<string, boolean>>
  readonly name: string
}

const toolsFrom = (value: unknown): ReadonlyArray<ListedTool> => {
  if (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    typeof value.result === "object" &&
    value.result !== null &&
    "tools" in value.result &&
    Array.isArray(value.result.tools)
  ) {
    return value.result.tools
  }

  throw new Error(`Expected a tools/list response, got ${JSON.stringify(value)}`)
}

const initialize = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
    protocolVersion: negotiatedProtocolVersion
  }
}

const connect = Effect.flatMap(stdioClient(Layer.succeed(VoilaOperations, inertEnvironment)), (client) =>
  Effect.as(client.exchange(initialize), client)
)

describe("Voila MCP stdio server", () => {
  it.scoped("negotiates a supported protocol version over stdio", () =>
    Effect.gen(function* () {
      const client = yield* stdioClient(Layer.succeed(VoilaOperations, inertEnvironment))

      expect(yield* client.exchange(initialize)).toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        result: { protocolVersion: negotiatedProtocolVersion, serverInfo: { name: mcpName } }
      })
    })
  )

  it.scoped("lists every tool with all four behaviour hints over stdio", () =>
    Effect.gen(function* () {
      const client = yield* connect

      const tools = toolsFrom(yield* client.exchange({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }))

      expect(tools.map((tool) => tool.name).sort()).toEqual(expectedToolNames)
      const mutationToolNames: ReadonlySet<string> = new Set([
        "voila_add_cart_items",
        "voila_remove_cart_items",
        "voila_reserve_slot"
      ])
      for (const tool of tools) {
        const expected = mutationToolNames.has(tool.name) ? mutationAnnotations : readOnlyAnnotations
        expect(tool.annotations).toMatchObject(expected)
      }
    })
  )

  it.scoped("reports a failed operation as a tool result over stdio", () =>
    Effect.gen(function* () {
      const client = yield* connect

      const called = yield* client.exchange({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "voila_get_cart" }
      })

      expect(called).toMatchObject({
        id: 2,
        jsonrpc: "2.0",
        result: {
          content: [{ text: expect.stringContaining("VoilaTestSessionUnavailable"), type: "text" }],
          isError: true
        }
      })
    })
  )
})
