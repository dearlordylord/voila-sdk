import { it } from "@effect/vitest"
import { Effect, Layer, Sink, Stdio, Stream } from "effect"
import { readFile } from "node:fs/promises"
import { describe, expect } from "vitest"

import { mcpName, type OperationEnvironment, VoilaOperations } from "../src/index.js"
import { voilaHttpServerLayer } from "../src/mcp-http-server.js"
import { isVoilaOperationName, voilaStdioServerLayer, voilaStdioStreamsLayer } from "../src/mcp-server.js"
import { packageVersion, resolvePackageVersion } from "../src/package-version.js"
import { HttpHostSchema, TcpPortSchema } from "../src/runtime-config.js"
import {
  getJson,
  emptyMcpResponse,
  jsonRpc,
  jsonRpcResponse,
  jsonRpcTextResponse,
  rawMcpResponse,
  testServerLayer,
  unsupportedMethodResponse
} from "./helpers/mcp-http.js"
import { makeStubEnvironment, unusedTransportLayer } from "./helpers/operations.js"

const testSessionFailure = "Session is unavailable in this protocol test"
const negotiatedProtocolVersion = "2025-06-18"
const olderProtocolVersion = "2024-11-05"

/**
 * An environment whose session cycle always fails. A protocol test is about
 * what the server advertises and how it reports, not about Voila: a failing
 * session gives every tool call a deterministic, typed failure to report.
 */
const inertEnvironment: OperationEnvironment = {
  session: {
    withAuthenticatedSession: () => Effect.fail({ _tag: "VoilaTestSessionUnavailable", message: testSessionFailure }),
    withSession: () => Effect.fail({ _tag: "VoilaTestSessionUnavailable", message: testSessionFailure })
  },
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

  it("recognizes only registered Voila operation names", () => {
    expect(isVoilaOperationName("voila_get_cart")).toBe(true)
    expect(isVoilaOperationName("not-a-voila-operation")).toBe(false)
  })

  it("constructs the default HTTP path and version server layer", () => {
    expect(
      Layer.isLayer(voilaHttpServerLayer({ host: HttpHostSchema.make("127.0.0.1"), port: TcpPortSchema.make(3_000) }))
    ).toBe(true)
  })

  it("keeps the build version and fallback version deterministic", () => {
    expect(packageVersion).toBe("0.0.0")
    expect(resolvePackageVersion(undefined)).toBe("0.0.0")
    expect(resolvePackageVersion("")).toBe("0.0.0")
    expect(resolvePackageVersion("1.2.3")).toBe("1.2.3")
  })

  it.effect("drains custom stderr and supports the process stdio default", () =>
    Effect.gen(function* () {
      const streams = voilaStdioStreamsLayer({ stdin: Stream.empty, stdout: Sink.drain })
      const stderr = yield* Effect.provide(
        Effect.map(Stdio.Stdio, (stdio) => stdio.stderr()),
        streams
      )

      yield* Stream.run(Stream.make("diagnostic"), stderr)
      expect(Layer.isLayer(voilaStdioServerLayer())).toBe(true)
    })
  )

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
      const fallback = yield* jsonRpc({
        id: 2,
        jsonrpc: "2.0",
        method: "initialize",
        params: { capabilities: {}, clientInfo: { name: "vitest", version: "0.0.0" }, protocolVersion: "2099-01-01" }
      })

      expect(negotiated).toMatchObject({
        id: 1,
        jsonrpc: "2.0",
        result: { protocolVersion: negotiatedProtocolVersion, serverInfo: { name: mcpName } }
      })
      expect(fallback).toMatchObject({ id: 2, result: { protocolVersion: negotiatedProtocolVersion } })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("retains the baseline protocol methods and version negotiation", () =>
    Effect.gen(function* () {
      const older = yield* jsonRpc({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "vitest", version: "0.0.0" },
          protocolVersion: olderProtocolVersion
        }
      })
      const ping = yield* jsonRpc({ id: 2, jsonrpc: "2.0", method: "ping", params: {} })
      const resources = yield* jsonRpc({ id: 3, jsonrpc: "2.0", method: "resources/list", params: {} })
      const templates = yield* jsonRpc({ id: 4, jsonrpc: "2.0", method: "resources/templates/list", params: {} })
      const prompts = yield* jsonRpc({ id: 5, jsonrpc: "2.0", method: "prompts/list", params: {} })
      const completion = yield* jsonRpc({
        id: 6,
        jsonrpc: "2.0",
        method: "completion/complete",
        params: { argument: { name: "query", value: "mil" }, ref: { name: "missing", type: "ref/prompt" } }
      })
      const missingPrompt = yield* jsonRpc({
        id: 7,
        jsonrpc: "2.0",
        method: "prompts/get",
        params: { name: "missing" }
      })
      const unsupportedLogging = yield* jsonRpc({
        id: 8,
        jsonrpc: "2.0",
        method: "logging/setLevel",
        params: { level: "info" }
      })
      const unknown = yield* jsonRpc({ id: 9, jsonrpc: "2.0", method: "unknown/method", params: {} })
      const statelessPing = yield* jsonRpc(
        { id: 10, jsonrpc: "2.0", method: "ping", params: {} },
        { "mcp-protocol-version": olderProtocolVersion, "mcp-session-id": "ignored-legacy-session" }
      )

      expect(older).toMatchObject({ id: 1, result: { protocolVersion: olderProtocolVersion } })
      expect(ping).toEqual({ id: 2, jsonrpc: "2.0", result: {} })
      expect(resources).toEqual({ id: 3, jsonrpc: "2.0", result: { resources: [] } })
      expect(templates).toEqual({ id: 4, jsonrpc: "2.0", result: { resourceTemplates: [] } })
      expect(prompts).toEqual({ id: 5, jsonrpc: "2.0", result: { prompts: [] } })
      expect(completion).toEqual({
        id: 6,
        jsonrpc: "2.0",
        result: { completion: { hasMore: false, total: 0, values: [] } }
      })
      expect(missingPrompt).toMatchObject({ error: { code: -32602 }, id: 7 })
      expect(unsupportedLogging).toMatchObject({ error: { code: -32603, message: "Not implemented" }, id: 8 })
      expect(unknown).toMatchObject({ error: { code: -32601 }, id: 9 })
      expect(statelessPing).toEqual({ id: 10, jsonrpc: "2.0", result: {} })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("rejects JSON-RPC batches as required by the RC.110 2025-06-18 transport", () =>
    Effect.gen(function* () {
      const response = yield* jsonRpcTextResponse([
        { id: 1, jsonrpc: "2.0", method: "ping", params: {} },
        { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }
      ])

      expect(response).toEqual({ body: "", status: 400 })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("acknowledges notifications without a JSON-RPC response body", () =>
    Effect.gen(function* () {
      const response = yield* jsonRpcTextResponse({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })

      expect(response).toEqual({ body: "", status: 202 })
    }).pipe(Effect.provide(ServerLive))
  )

  it.effect("rejects an Accept media type disabled by its quality value", () =>
    Effect.gen(function* () {
      const response = yield* jsonRpcTextResponse(
        { id: 1, jsonrpc: "2.0", method: "tools/list", params: {} },
        { accept: "application/json, text/event-stream;q=0" }
      )

      expect(response).toEqual({ body: "", status: 406 })
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

  it.effect("covers malformed protocol requests, media negotiation, and unsupported methods", () =>
    Effect.gen(function* () {
      const wrongContentType = yield* rawMcpResponse(
        JSON.stringify({ id: 1, jsonrpc: "2.0", method: "ping", params: {} }),
        {},
        "text/plain"
      )
      const missingContentType = yield* emptyMcpResponse()
      const missingAccept = yield* jsonRpcTextResponse(
        { id: 2, jsonrpc: "2.0", method: "ping", params: {} },
        { accept: "application/json" }
      )
      const invalidAcceptQuality = yield* jsonRpcTextResponse(
        { id: 10, jsonrpc: "2.0", method: "ping", params: {} },
        { accept: "application/json;q=2, text/event-stream" }
      )
      const validAcceptQuality = yield* jsonRpcTextResponse(
        { id: 11, jsonrpc: "2.0", method: "ping", params: {} },
        { accept: "application/json;q=0.5, text/event-stream" }
      )
      const malformedJson = yield* rawMcpResponse("{")
      const malformedRequest = yield* jsonRpc({ id: 3, jsonrpc: "1.0", method: "ping", params: {} })
      const invalidInitialize = yield* jsonRpc({ id: 4, jsonrpc: "2.0", method: "initialize", params: {} })
      const invalidList = yield* jsonRpc({ id: 5, jsonrpc: "2.0", method: "tools/list", params: [] })
      const invalidCall = yield* jsonRpc({
        id: 6,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: 42, arguments: {} }
      })
      const unknownTool = yield* jsonRpc({
        id: 7,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "missing", arguments: {} }
      })
      const invalidPing = yield* jsonRpc({ id: 8, jsonrpc: "2.0", method: "ping", params: [] })
      const unsupported = yield* unsupportedMethodResponse("GET")
      const invalidOrigin = yield* jsonRpcResponse(
        { id: 9, jsonrpc: "2.0", method: "ping", params: {} },
        { origin: "not-a-url" }
      )

      expect(wrongContentType).toEqual({ body: "", status: 415 })
      expect(missingContentType).toEqual({ body: "", status: 415 })
      expect(missingAccept).toEqual({ body: "", status: 406 })
      expect(invalidAcceptQuality).toEqual({ body: "", status: 406 })
      expect(validAcceptQuality).toMatchObject({ status: 200 })
      expect(malformedJson).toMatchObject({ status: 200 })
      expect(JSON.parse(malformedJson.body)).toMatchObject({ error: { code: -32600 }, id: null })
      expect(malformedRequest).toMatchObject({ error: { code: -32600 }, id: null })
      expect(invalidInitialize).toMatchObject({ error: { code: -32602 }, id: 4 })
      expect(invalidList).toMatchObject({ error: { code: -32602 }, id: 5 })
      expect(invalidCall).toMatchObject({ error: { code: -32602 }, id: 6 })
      expect(unknownTool).toMatchObject({ error: { code: -32602, message: "Tool 'missing' not found" }, id: 7 })
      expect(invalidPing).toMatchObject({ error: { code: -32602 }, id: 8 })
      expect(unsupported).toEqual({ body: "", status: 405 })
      expect(invalidOrigin).toMatchObject({
        body: { error: "forbidden_origin", message: expect.any(String) },
        status: 403
      })
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
