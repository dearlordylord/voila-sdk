import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { createVoilaMcpServer } from "./mcp-server.js"
import { mcpName, type OperationEnvironment } from "./operations.js"

const defaultHttpPath = "/mcp"

export interface VoilaMcpHttpServerOptions {
  readonly host: string
  readonly path?: string
  readonly port: number
}

const responseJsonHeaders = {
  "content-type": "application/json"
}

const writeJsonResponse = (
  response: ServerResponse,
  status: number,
  value: unknown
): void => {
  response.writeHead(status, responseJsonHeaders)
  response.end(JSON.stringify(value))
}

const requestPathname = (request: IncomingMessage): string => {
  const host = request.headers.host ?? "localhost"
  const url = new URL(request.url ?? "/", `http://${host}`)

  return url.pathname
}

const firstHeaderValue = (value: string | Array<string> | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const isInitializeMessage = (value: unknown): boolean =>
  typeof value === "object"
  && value !== null
  && "method" in value
  && value.method === "initialize"

const isInitializePayload = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(isInitializeMessage) : isInitializeMessage(value)

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Array<string> = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk))
  }

  return JSON.parse(chunks.join(""))
}

const makeTransportAdapter = (transport: StreamableHTTPServerTransport): Transport => {
  const adapter: Transport = {
    close: () => transport.close(),
    send: (message, options) => transport.send(message, options),
    start: () => transport.start()
  }

  Object.defineProperties(adapter, {
    onclose: {
      get: () => transport.onclose,
      set: (handler: Transport["onclose"]) => {
        transport.onclose = handler
      }
    },
    onerror: {
      get: () => transport.onerror,
      set: (handler: Transport["onerror"]) => {
        transport.onerror = handler
      }
    },
    onmessage: {
      get: () => transport.onmessage,
      set: (handler: Transport["onmessage"]) => {
        transport.onmessage = handler
      }
    },
    sessionId: {
      get: () => transport.sessionId
    }
  })

  return adapter
}

const makeConnectedHttpTransport = async (
  env: OperationEnvironment,
  transports: Map<string, StreamableHTTPServerTransport>,
  version?: string
): Promise<StreamableHTTPServerTransport> => {
  const server = createVoilaMcpServer(env, version)
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    onsessionclosed: (sessionId) => {
      transports.delete(sessionId)
    },
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport)
    },
    sessionIdGenerator: randomUUID
  })

  await server.connect(makeTransportAdapter(transport))

  return transport
}

const lookupHttpTransport = (
  request: IncomingMessage,
  transports: Map<string, StreamableHTTPServerTransport>
): StreamableHTTPServerTransport | undefined => {
  const sessionId = firstHeaderValue(request.headers["mcp-session-id"])

  return sessionId === undefined ? undefined : transports.get(sessionId)
}

export const createHttpServer = (
  env: OperationEnvironment,
  options: VoilaMcpHttpServerOptions,
  version?: string
): Server => {
  const mcpPath = options.path ?? defaultHttpPath
  const transports = new Map<string, StreamableHTTPServerTransport>()

  return createServer((request, response) => {
    const pathname = requestPathname(request)

    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      writeJsonResponse(response, 200, {
        name: mcpName,
        status: "ok"
      })

      return
    }

    if (pathname !== mcpPath) {
      writeJsonResponse(response, 404, {
        error: "not_found"
      })

      return
    }

    void handleMcpRequest(request, response, env, transports, version).catch(() => {
      if (!response.headersSent) {
        writeJsonResponse(response, 500, {
          error: "mcp_request_failed"
        })

        return
      }

      response.end()
    })
  })
}

const handleMcpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  env: OperationEnvironment,
  transports: Map<string, StreamableHTTPServerTransport>,
  version?: string
): Promise<void> => {
  if (request.method !== "POST") {
    const transport = lookupHttpTransport(request, transports)

    if (transport === undefined) {
      writeJsonResponse(response, 400, {
        error: "mcp_session_required"
      })

      return
    }

    await transport.handleRequest(request, response)

    return
  }

  const body = await readJsonBody(request)
  const transport = isInitializePayload(body)
    ? await makeConnectedHttpTransport(env, transports, version)
    : lookupHttpTransport(request, transports)

  if (transport === undefined) {
    writeJsonResponse(response, 400, {
      error: "mcp_session_required"
    })

    return
  }

  await transport.handleRequest(request, response, body)
}

export const startHttpServer = async (
  env: OperationEnvironment,
  options: VoilaMcpHttpServerOptions,
  version?: string
): Promise<Server> => {
  const server = createHttpServer(env, options, version)

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error)
    }

    server.once("error", onError)
    server.listen(options.port, options.host, () => {
      server.off("error", onError)
      resolve()
    })
  })

  return server
}
