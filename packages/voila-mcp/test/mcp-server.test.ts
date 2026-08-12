import { Either } from "effect"
import type { Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"

import { createHttpServer, mcpName, type OperationEnvironment } from "../src/index.js"

const httpOk = 200
const mcpProtocolVersion = "2025-11-25"

const inertEnvironment: OperationEnvironment = {
  session: {
    load: async () =>
      Either.left({ _tag: "VoilaTestSessionUnavailable", message: "Session is unavailable in this protocol test" }),
    save: async () => Either.right(undefined)
  },
  transport: { request: async () => Either.left("Network is unavailable in this protocol test") }
}

const startedServers: Array<Server> = []

const serverPort = (server: Server): number => {
  const address = server.address()

  if (typeof address === "object" && address !== null) {
    return address.port
  }

  throw new Error("Expected HTTP server to have a TCP address")
}

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error)

        return
      }

      resolve()
    })
  })

const postMcp = async (url: string, body: unknown, sessionId?: string): Promise<Response> =>
  fetch(url, {
    body: JSON.stringify(body),
    headers: {
      ...(sessionId === undefined ? {} : { "mcp-protocol-version": mcpProtocolVersion, "mcp-session-id": sessionId }),
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    method: "POST"
  })

const toolsFrom = (value: unknown): Array<unknown> => {
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

  throw new Error("Expected tools/list response")
}

const toolNamesFrom = (tools: Array<unknown>): Array<string> =>
  tools.flatMap((tool) => {
    if (typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string") {
      return [tool.name]
    }

    return []
  })

const toolByName = (tools: Array<unknown>, name: string): unknown =>
  tools.find((tool) => typeof tool === "object" && tool !== null && "name" in tool && tool.name === name)

const initializeSession = async (baseUrl: string, id: number): Promise<string> => {
  const initialize = await postMcp(`${baseUrl}/mcp`, {
    id,
    jsonrpc: "2.0",
    method: "initialize",
    params: { capabilities: {}, clientInfo: { name: "vitest", version: "0.0.0" }, protocolVersion: mcpProtocolVersion }
  })
  const sessionId = initialize.headers.get("mcp-session-id")

  expect(initialize.status).toBe(httpOk)
  expect(sessionId).toBeTruthy()

  if (sessionId === null) {
    throw new Error("Expected MCP session ID")
  }

  await postMcp(`${baseUrl}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId)

  return sessionId
}

const initializeAndListTools = async (baseUrl: string, idOffset: number): Promise<Array<unknown>> => {
  const sessionId = await initializeSession(baseUrl, idOffset)

  const tools = await postMcp(
    `${baseUrl}/mcp`,
    { id: idOffset + 1, jsonrpc: "2.0", method: "tools/list", params: {} },
    sessionId
  )

  expect(tools.status).toBe(httpOk)

  return toolsFrom(await tools.json())
}

const expectEmptyToolExecution = async (id: number, response: Response): Promise<void> => {
  expect(response.status).toBe(httpOk)
  expect(await response.json()).toMatchObject({
    id,
    jsonrpc: "2.0",
    result: {
      content: [{ text: expect.stringContaining("Session is unavailable in this protocol test"), type: "text" }],
      isError: true
    }
  })
}

afterEach(async () => {
  const servers = startedServers.splice(0)

  await Promise.all(servers.map(closeServer))
})

describe("Voila MCP HTTP server", () => {
  it("supports independent Streamable HTTP initialization and tool listing sessions", async () => {
    const server = createHttpServer(inertEnvironment, { host: "127.0.0.1", port: 0 })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })
    startedServers.push(server)

    const baseUrl = `http://127.0.0.1:${serverPort(server)}`
    const health = await fetch(`${baseUrl}/health`)

    expect(health.status).toBe(httpOk)

    const firstTools = await initializeAndListTools(baseUrl, 1)
    const secondTools = await initializeAndListTools(baseUrl, 3)
    const toolNames = toolNamesFrom(secondTools)

    expect(toolNames).toContain("voila_search_products")
    expect(toolNames).toContain("voila_get_cart")
    expect(toolNamesFrom(firstTools)).toEqual(toolNames)
    expect(toolByName(secondTools, "voila_search_products")).toMatchObject({
      annotations: { readOnlyHint: true },
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: false,
        properties: { pageSize: { maximum: 24, minimum: 1, type: "integer" }, query: { minLength: 1, type: "string" } },
        required: ["query"],
        type: "object"
      }
    })
    expect(toolByName(secondTools, "voila_add_cart_items")).toMatchObject({
      annotations: { destructiveHint: true, readOnlyHint: false }
    })
    expect(toolByName(secondTools, "voila_get_cart")).toMatchObject({
      inputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" }
    })
  })

  it("exposes the canonical MCP package name", () => {
    expect(mcpName).toBe("io.github.dearlordylord/voila-mcp")
  })

  it("rejects tool input that violates the advertised Effect schema", async () => {
    const server = createHttpServer(inertEnvironment, { host: "127.0.0.1", port: 0 })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })
    startedServers.push(server)

    const baseUrl = `http://127.0.0.1:${serverPort(server)}`
    const sessionId = await initializeSession(baseUrl, 10)
    const response = await postMcp(
      `${baseUrl}/mcp`,
      {
        id: 11,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { query: " milk " }, name: "voila_search_products" }
      },
      sessionId
    )

    expect(response.status).toBe(httpOk)
    expect(await response.json()).toMatchObject({
      id: 11,
      jsonrpc: "2.0",
      result: { content: [{ text: expect.stringContaining("Input validation error"), type: "text" }], isError: true }
    })
  })

  it("executes empty-input tools with explicit and omitted arguments", async () => {
    const server = createHttpServer(inertEnvironment, { host: "127.0.0.1", port: 0 })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })
    startedServers.push(server)

    const baseUrl = `http://127.0.0.1:${serverPort(server)}`
    const sessionId = await initializeSession(baseUrl, 20)
    const explicitArguments = await postMcp(
      `${baseUrl}/mcp`,
      { id: 21, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name: "voila_get_cart" } },
      sessionId
    )
    const omittedArguments = await postMcp(
      `${baseUrl}/mcp`,
      { id: 22, jsonrpc: "2.0", method: "tools/call", params: { name: "voila_get_cart" } },
      sessionId
    )

    await expectEmptyToolExecution(21, explicitArguments)
    await expectEmptyToolExecution(22, omittedArguments)
  })
})
