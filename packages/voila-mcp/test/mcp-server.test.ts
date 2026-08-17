import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { readFile } from "node:fs/promises"
import { describe, expect } from "vitest"

import { mcpName, type OperationEnvironment, VoilaOperations } from "../src/index.js"
import { getJson, jsonRpc, jsonRpcResponse, testServerLayer } from "./helpers/mcp-http.js"
import { makeStubEnvironment, unusedTransportLayer } from "./helpers/operations.js"

const testSessionFailure = "Session is unavailable in this protocol test"
const negotiatedProtocolVersion = "2025-06-18"

/**
 * An environment whose session cycle always fails. A protocol test is about
 * what the server advertises and how it reports, not about Voila: a failing
 * session gives every tool call a deterministic, typed failure to report.
 */
const inertEnvironment: OperationEnvironment = {
  session: { withSession: () => Effect.fail({ _tag: "VoilaTestSessionUnavailable", message: testSessionFailure }) },
  transport: unusedTransportLayer
}

const ServerLive = testServerLayer(Layer.succeed(VoilaOperations, inertEnvironment))

const cartFixture = await readFile(
  new URL("../../voila-sdk/test/fixtures/cart-view-non-empty.json", import.meta.url),
  "utf8"
)

// a server whose one scripted response is a real cart read: the success half of
// the wire contract encodes and validates against a different schema than the
// failure half, so a suite that only ever fails never sees it
const CartServerLive = testServerLayer(
  Layer.succeed(
    VoilaOperations,
    makeStubEnvironment(() => Effect.succeed({ body: cartFixture, headers: {}, status: 200 })).env
  )
)

const expectedToolNames = [
  "voila_check_session_health",
  "voila_get_active_shopping_context",
  "voila_get_slot_listings",
  "voila_reserve_slot",
  "voila_search_products",
  "voila_get_category_products",
  "voila_get_discounted_products",
  "voila_get_completed_orders",
  "voila_get_order_details",
  "voila_get_completed_order_items",
  "voila_get_cart",
  "voila_add_cart_items",
  "voila_remove_cart_items"
]

const readOnlyAnnotations = { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: true }

const mutationAnnotations = { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false }

const initialize = (id: number) =>
  jsonRpc({
    id,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" },
      protocolVersion: negotiatedProtocolVersion
    }
  })

const listTools = (id: number) => jsonRpc({ id, jsonrpc: "2.0", method: "tools/list", params: {} })

const callTool = (id: number, name: string, args: unknown) =>
  jsonRpc({ id, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } })

interface ListedTool {
  readonly annotations: Readonly<Record<string, boolean>>
  readonly inputSchema: Readonly<Record<string, unknown>>
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

  throw new Error("Expected a tools/list response")
}

const toolByName = (tools: ReadonlyArray<ListedTool>, name: string): ListedTool => {
  const tool = tools.find((listed) => listed.name === name)

  if (tool === undefined) {
    throw new Error(`Expected tools/list to advertise ${name}`)
  }

  return tool
}

describe("Voila MCP HTTP server", () => {
  it("exposes the canonical MCP package name", () => {
    expect(mcpName).toBe("io.github.dearlordylord/voila-mcp")
  })

  it.effect("answers liveness on / and /health", () =>
    Effect.gen(function* () {
      const root = yield* getJson("/")
      const health = yield* getJson("/health")

      expect(root).toEqual({ body: { name: mcpName, status: "ok" }, status: 200 })
      expect(health).toEqual({ body: { name: mcpName, status: "ok" }, status: 200 })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("negotiates a supported protocol version", () =>
    Effect.gen(function* () {
      const negotiated = yield* initialize(1)

      expect(negotiated).toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        result: { protocolVersion: negotiatedProtocolVersion, serverInfo: { name: mcpName } }
      })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("lists every tool with all four behaviour hints stated", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      const tools = toolsFrom(yield* listTools(2))

      expect(tools.map((tool) => tool.name).sort()).toEqual([...expectedToolNames].sort())
      const mutationToolNames: ReadonlySet<string> = new Set([
        "voila_add_cart_items",
        "voila_remove_cart_items",
        "voila_reserve_slot"
      ])
      for (const tool of tools) {
        const expected = mutationToolNames.has(tool.name) ? mutationAnnotations : readOnlyAnnotations
        expect(tool.annotations).toMatchObject(expected)
      }
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("advertises the Effect schema bounds clients must respect", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      const tools = toolsFrom(yield* listTools(2))

      // no `$schema` marker is emitted; the constraints that decide what a
      // client may send are what matters, and they survive
      expect(toolByName(tools, "voila_search_products").inputSchema).toMatchObject({
        additionalProperties: false,
        properties: { pageSize: { maximum: 24, minimum: 1, type: "integer" }, query: { minLength: 1, type: "string" } },
        required: ["query"],
        type: "object"
      })
      expect(toolByName(tools, "voila_get_cart").inputSchema).toMatchObject({
        additionalProperties: false,
        properties: {},
        required: [],
        type: "object"
      })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("returns a successful tool result with structured content", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      const called = yield* callTool(2, "voila_get_cart", {})

      expect(called).toMatchObject({
        id: 2,
        jsonrpc: "2.0",
        result: { structuredContent: { ok: true, value: { totals: expect.anything() } } }
      })
      expect(called).not.toMatchObject({ result: { isError: true } })
    }).pipe(Effect.provide(CartServerLive))
  )

  it.effect("reports a failed operation as a tool result rather than a protocol error", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      const called = yield* callTool(2, "voila_get_cart", {})

      expect(called).toMatchObject({
        id: 2,
        jsonrpc: "2.0",
        result: {
          content: [{ text: expect.stringContaining("VoilaTestSessionUnavailable"), type: "text" }],
          isError: true
        }
      })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("refuses a browser request from a foreign origin, and serves a local one", () =>
    Effect.gen(function* () {
      const foreign = yield* jsonRpcResponse(
        { id: 1, jsonrpc: "2.0", method: "tools/list", params: {} },
        { origin: "https://attacker.example" }
      )

      expect(foreign.status).toBe(403)
      expect(foreign.body).toMatchObject({ error: "forbidden_origin" })

      const local = yield* jsonRpcResponse(
        {
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "vitest", version: "0.0.0" },
            protocolVersion: negotiatedProtocolVersion
          }
        },
        { origin: "http://localhost:3000" }
      )

      expect(local.status).toBe(200)
      expect(local.body).toMatchObject({ result: { protocolVersion: negotiatedProtocolVersion } })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("rejects a call that omits arguments, which the MCP schema requires", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      // the exact payload is a defect and is not pinned; what a client needs to
      // know is that omitting `arguments` is a protocol error, not a result
      const called = yield* jsonRpc({ id: 2, jsonrpc: "2.0", method: "tools/call", params: { name: "voila_get_cart" } })

      expect(called).toMatchObject({ id: 2, jsonrpc: "2.0" })
      expect(called).toHaveProperty("error")
      expect(called).not.toHaveProperty("result")
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("rejects tool input that violates the advertised schema, without touching the session", () =>
    Effect.gen(function* () {
      yield* initialize(1)

      // an untrimmed query violates the trimmed-string refinement the schema
      // advertises: the decode fails before any operation runs
      const called = yield* callTool(2, "voila_search_products", { query: " milk " })

      expect(called).toMatchObject({ id: 2, jsonrpc: "2.0", result: { isError: true } })
      expect(JSON.stringify(called)).not.toContain(testSessionFailure)
    }).pipe(Effect.provide(ServerLive))
  )
})
