import { McpServer } from "@effect/ai"
import { HttpMiddleware, HttpRouter, type HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import type { ServeError } from "@effect/platform/HttpServerError"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"

import { voilaToolsLayer, type VoilaOperations } from "./mcp-server.js"
import { mcpName } from "./operation-descriptors.js"
import { packageVersion } from "./package-version.js"

export const defaultHttpPath = "/mcp"
const forbiddenStatus = 403

export interface VoilaMcpHttpServerOptions {
  readonly host: string
  readonly path?: HttpRouter.PathInput
  readonly port: number
}

const healthBody = { name: mcpName, status: "ok" }

/**
 * The two routes that are ours rather than MCP's. Deployment guidance points
 * at `/health`, and a bare `GET /` is what a human types first, so both answer
 * the same liveness JSON.
 */
const healthRoutes = HttpRouter.Default.use((router) =>
  Effect.all([
    router.get("/", HttpServerResponse.json(healthBody)),
    router.get("/health", HttpServerResponse.json(healthBody))
  ])
)

const localOriginHosts = new Set(["127.0.0.1", "[::1]", "localhost"])

const forbiddenOriginBody = {
  error: "forbidden_origin",
  message: "Voila MCP over HTTP accepts browser requests from local origins only"
}

const isLocalOrigin = (origin: string | undefined): boolean => {
  // a non-browser client (an MCP stdio bridge, curl, a gateway) sends no
  // Origin at all; only a browser-issued request has one to check
  if (origin === undefined) {
    return true
  }

  try {
    return localOriginHosts.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

/**
 * Refuses a browser request from a foreign origin. The tools mutate a real
 * cart, and a page the user happens to have open must not be able to drive them
 * by pointing a request at a loopback port — DNS rebinding turns "bound to
 * 127.0.0.1" into no protection at all.
 */
const originGuard = HttpMiddleware.make((app) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    isLocalOrigin(request.headers.origin)
      ? app
      : Effect.succeed(HttpServerResponse.unsafeJson(forbiddenOriginBody, { status: forbiddenStatus }))
  )
)

/**
 * The MCP endpoint and the liveness routes, mounted but not served: what host
 * and port they listen on is the caller's decision, and a protocol test serves
 * them over an in-process client rather than a real socket.
 */
export const voilaMcpRoutesLayer = (
  path: HttpRouter.PathInput = defaultHttpPath,
  version: string = packageVersion
): Layer.Layer<never, never, HttpServer.HttpServer | VoilaOperations> =>
  Layer.mergeAll(voilaToolsLayer, healthRoutes, HttpRouter.Default.serve(originGuard)).pipe(
    Layer.provide(McpServer.layerHttp({ name: mcpName, path, version }))
  )

export const voilaHttpServerLayer = (
  options: VoilaMcpHttpServerOptions,
  version: string = packageVersion
): Layer.Layer<never, ServeError, VoilaOperations> =>
  Layer.provide(
    voilaMcpRoutesLayer(options.path ?? defaultHttpPath, version),
    NodeHttpServer.layer(createServer, { host: options.host, port: options.port })
  )
