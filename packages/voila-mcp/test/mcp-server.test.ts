import { Either } from "effect"
import type { Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"

import { createHttpServer, mcpName, type OperationEnvironment } from "../src/index.js"

const httpOk = 200
const mcpProtocolVersion = "2025-11-25"

const inertEnvironment: OperationEnvironment = {
  session: {
    load: async () =>
      Either.left({
        _tag: "VoilaTestSessionUnavailable",
        message: "Session is unavailable in this protocol test"
      }),
    save: async () => Either.right(undefined)
  },
  transport: {
    request: async () => Either.left("Network is unavailable in this protocol test")
  }
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

const postMcp = async (
  url: string,
  body: unknown,
  sessionId?: string
): Promise<Response> =>
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
    typeof value === "object"
    && value !== null
    && "result" in value
    && typeof value.result === "object"
    && value.result !== null
    && "tools" in value.result
    && Array.isArray(value.result.tools)
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
  tools.find((tool) =>
    typeof tool === "object"
    && tool !== null
    && "name" in tool
    && tool.name === name
  )

const initializeAndListTools = async (
  baseUrl: string,
  idOffset: number
): Promise<Array<unknown>> => {
  const initialize = await postMcp(`${baseUrl}/mcp`, {
    id: idOffset,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: {
        name: "vitest",
        version: "0.0.0"
      },
      protocolVersion: mcpProtocolVersion
    }
  })
  const sessionId = initialize.headers.get("mcp-session-id")

  expect(initialize.status).toBe(httpOk)
  expect(sessionId).toBeTruthy()

  await postMcp(`${baseUrl}/mcp`, {
    jsonrpc: "2.0",
    method: "notifications/initialized"
  }, sessionId ?? undefined)

  const tools = await postMcp(`${baseUrl}/mcp`, {
    id: idOffset + 1,
    jsonrpc: "2.0",
    method: "tools/list",
    params: {}
  }, sessionId ?? undefined)

  expect(tools.status).toBe(httpOk)

  return toolsFrom(await tools.json())
}

afterEach(async () => {
  const servers = startedServers.splice(0)

  await Promise.all(servers.map(closeServer))
})

describe("Voila MCP HTTP server", () => {
  it("supports independent Streamable HTTP initialization and tool listing sessions", async () => {
    const server = await createHttpServer(inertEnvironment, {
      host: "127.0.0.1",
      port: 0
    })

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
      annotations: {
        readOnlyHint: true
      }
    })
    expect(toolByName(secondTools, "voila_add_cart_items")).toMatchObject({
      annotations: {
        destructiveHint: true,
        readOnlyHint: false
      }
    })
  })

  it("exposes the canonical MCP package name", () => {
    expect(mcpName).toBe("io.github.dearlordylord/voila-mcp")
  })
})
