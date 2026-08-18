import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Result, Schema } from "effect"
import { McpSchema } from "effect/unstable/ai"
import {
  HttpMiddleware,
  HttpRouter,
  type HttpServer,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http"
import type { ServeError } from "effect/unstable/http/HttpServerError"
import { createServer } from "node:http"

import { executeVoilaTool } from "./mcp-tool-registry.js"
import { type VoilaMcpToolRecord, VoilaOperations, voilaMcpTools } from "./mcp-toolkit.js"
import { mcpName } from "./operation-descriptors.js"
import { packageVersion } from "./package-version.js"

export const defaultHttpPath = "/mcp"
const forbiddenStatus = 403
const badRequestStatus = 400

export interface VoilaMcpHttpServerOptions {
  readonly host: string
  readonly path?: HttpRouter.PathInput
  readonly port: number
}

const HealthBodySchema = Schema.Struct({ name: Schema.String, status: Schema.Literal("ok") })
const healthBody = Schema.decodeUnknownSync(HealthBodySchema)({ name: mcpName, status: "ok" })

/**
 * The two routes that are ours rather than MCP's. Deployment guidance points
 * at `/health`, and a bare `GET /` is what a human types first, so both answer
 * the same liveness JSON.
 */
const healthRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.json(healthBody)),
  HttpRouter.add("GET", "/health", HttpServerResponse.json(healthBody))
)

const localOriginHosts = new Set(["127.0.0.1", "[::1]", "localhost"])

const ForbiddenOriginBodySchema = Schema.Struct({ error: Schema.Literal("forbidden_origin"), message: Schema.String })
const forbiddenOriginBody = Schema.decodeUnknownSync(ForbiddenOriginBodySchema)({
  error: "forbidden_origin",
  message: "Voila MCP over HTTP accepts browser requests from local origins only"
})

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
      : Effect.succeed(HttpServerResponse.jsonUnsafe(forbiddenOriginBody, { status: forbiddenStatus }))
  )
)

const mediaTypes = (header: string | undefined): ReadonlyArray<string> =>
  header === undefined
    ? []
    : header.split(",").flatMap((part) => {
        const [mediaType, ...parameters] = part.split(";")
        const quality = parameters
          .map((parameter) => parameter.trim().toLowerCase())
          .find((parameter) => parameter.startsWith("q="))
        if (quality !== undefined) {
          const value = Number(quality.slice(2))
          if (!Number.isFinite(value) || value <= 0 || value > 1) {
            return []
          }
        }
        return [mediaType?.trim().toLowerCase() ?? ""]
      })

const methodNotAllowedResponse = HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } })

const jsonRpcVersion = "2.0"
const protocolVersion = "2025-06-18"
const supportedProtocolVersions: ReadonlySet<string> = new Set([
  protocolVersion,
  "2025-03-26",
  "2024-11-05",
  "2024-10-07"
])
const invalidRequestCode = -32600
const methodNotFoundCode = -32601
const invalidParamsCode = -32602
const internalErrorCode = -32603

const JsonRpcRequestSchema = Schema.Struct({
  id: McpSchema.RequestId,
  jsonrpc: Schema.Literal(jsonRpcVersion),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown)
})

const JsonRpcNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal(jsonRpcVersion),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown)
})

type JsonRpcId = Schema.Schema.Type<typeof JsonRpcRequestSchema>["id"]

const JsonRpcErrorSchema = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  code: Schema.Number.pipe(Schema.check(Schema.isInt())),
  data: Schema.optionalKey(Schema.Json),
  message: Schema.String
})

const JsonRpcErrorResponseSchema = Schema.Struct({
  error: JsonRpcErrorSchema,
  id: Schema.Union([McpSchema.RequestId, Schema.Null]),
  jsonrpc: Schema.Literal(jsonRpcVersion)
})

const JsonRpcResultResponseSchema = Schema.Struct({
  id: McpSchema.RequestId,
  jsonrpc: Schema.Literal(jsonRpcVersion),
  result: Schema.Json
})

const RequiredCallToolPayloadSchema = Schema.Struct({
  ...McpSchema.RequestMeta.fields,
  name: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Any)
})

const jsonRpcError = (
  id: JsonRpcId | null,
  code: number,
  message: string,
  options: { readonly data?: Schema.Json; readonly tag?: string } = {}
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(
    Schema.decodeUnknownSync(JsonRpcErrorResponseSchema)({
      error: {
        code,
        message,
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.tag === undefined ? {} : { _tag: options.tag })
      },
      id,
      jsonrpc: jsonRpcVersion
    })
  )

const jsonRpcResult = (id: JsonRpcId, result: unknown): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(
    Schema.decodeUnknownSync(JsonRpcResultResponseSchema)({ id, jsonrpc: jsonRpcVersion, result })
  )

const encodeMcpResult = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: Schema.Schema.Type<S>
): Schema.Json => Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value))

const invalidRequest = (id: JsonRpcId | null = null): HttpServerResponse.HttpServerResponse =>
  jsonRpcError(id, invalidRequestCode, "Invalid Request")

const invalidParams = (id: JsonRpcId, message = "Invalid method parameters"): HttpServerResponse.HttpServerResponse =>
  jsonRpcError(id, invalidParamsCode, message)

const missingArguments = (id: JsonRpcId, params: unknown): HttpServerResponse.HttpServerResponse => {
  const decoded = Schema.decodeUnknownResult(RequiredCallToolPayloadSchema)(params)
  const defect = Result.isFailure(decoded) ? decoded.failure.message : "Missing required tool arguments"
  const die = { _tag: "Die", defect }
  return jsonRpcError(id, 0, JSON.stringify(die), { data: die, tag: "Cause" })
}

const toolFor = (name: string): VoilaMcpToolRecord | undefined => voilaMcpTools.find((record) => record.name === name)

const hasArguments = (params: unknown): boolean =>
  typeof params === "object" && params !== null && Object.hasOwn(params, "arguments")

const isNotification = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Object.hasOwn(value, "id")) {
    return false
  }

  const decoded = Schema.decodeUnknownResult(JsonRpcNotificationSchema)(value)
  return Result.isSuccess(decoded) && decoded.success.method.startsWith("notifications/")
}

const initializeResult = (version: string, requestedProtocolVersion: string) =>
  McpSchema.InitializeResult.make({
    capabilities: { completions: {}, tools: { listChanged: true } },
    protocolVersion: supportedProtocolVersions.has(requestedProtocolVersion)
      ? requestedProtocolVersion
      : protocolVersion,
    serverInfo: { name: mcpName, version }
  })

const handleInitialize = (id: JsonRpcId, params: unknown, version: string) => {
  const decoded = Schema.decodeUnknownResult(McpSchema.Initialize.payloadSchema)(params)
  return Result.isFailure(decoded)
    ? invalidParams(id)
    : jsonRpcResult(
        id,
        encodeMcpResult(McpSchema.InitializeResult, initializeResult(version, decoded.success.protocolVersion))
      )
}

const handleListTools = (id: JsonRpcId, params: unknown) => {
  const decoded = Schema.decodeUnknownResult(McpSchema.ListTools.payloadSchema)(params)
  return Result.isFailure(decoded)
    ? invalidParams(id)
    : jsonRpcResult(
        id,
        encodeMcpResult(
          McpSchema.ListToolsResult,
          new McpSchema.ListToolsResult({ tools: voilaMcpTools.map((record) => record.tool) })
        )
      )
}

const handleCallTool = (
  id: JsonRpcId,
  params: unknown,
  operations: VoilaOperations["Service"]
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (!hasArguments(params)) {
    return Effect.succeed(missingArguments(id, params))
  }
  const decoded = Schema.decodeUnknownResult(McpSchema.CallTool.payloadSchema)(params)
  if (Result.isFailure(decoded)) {
    return Effect.succeed(invalidParams(id))
  }
  const tool = toolFor(decoded.success.name)
  return tool === undefined
    ? Effect.succeed(invalidParams(id, `Tool '${decoded.success.name}' not found`))
    : Effect.map(executeVoilaTool(tool.name, decoded.success.arguments, operations), (result) =>
        jsonRpcResult(id, encodeMcpResult(McpSchema.CallToolResult, result))
      )
}

type BaselineMethodHandler = (id: JsonRpcId, params: unknown) => HttpServerResponse.HttpServerResponse

const payloadResponse = (id: JsonRpcId, valid: boolean, result: Schema.Json): HttpServerResponse.HttpServerResponse =>
  valid ? jsonRpcResult(id, result) : invalidParams(id)

const baselineMethodHandlers: ReadonlyMap<string, BaselineMethodHandler> = new Map([
  [
    "ping",
    (id, params) =>
      payloadResponse(
        id,
        Result.isSuccess(Schema.decodeUnknownResult(McpSchema.Ping.payloadSchema)(params)),
        encodeMcpResult(McpSchema.Ping.successSchema, {})
      )
  ],
  [
    "completion/complete",
    (id, params) =>
      payloadResponse(
        id,
        Result.isSuccess(Schema.decodeUnknownResult(McpSchema.Complete.payloadSchema)(params)),
        encodeMcpResult(McpSchema.CompleteResult, McpSchema.CompleteResult.empty)
      )
  ],
  [
    "prompts/list",
    (id, params) =>
      payloadResponse(
        id,
        Result.isSuccess(Schema.decodeUnknownResult(McpSchema.ListPrompts.payloadSchema)(params)),
        encodeMcpResult(McpSchema.ListPromptsResult, new McpSchema.ListPromptsResult({ prompts: [] }))
      )
  ],
  [
    "resources/list",
    (id, params) =>
      payloadResponse(
        id,
        Result.isSuccess(Schema.decodeUnknownResult(McpSchema.ListResources.payloadSchema)(params)),
        encodeMcpResult(McpSchema.ListResourcesResult, new McpSchema.ListResourcesResult({ resources: [] }))
      )
  ],
  [
    "resources/templates/list",
    (id, params) =>
      payloadResponse(
        id,
        Result.isSuccess(Schema.decodeUnknownResult(McpSchema.ListResourceTemplates.payloadSchema)(params)),
        encodeMcpResult(
          McpSchema.ListResourceTemplatesResult,
          new McpSchema.ListResourceTemplatesResult({ resourceTemplates: [] })
        )
      )
  ]
])

const unavailableMethods: ReadonlySet<string> = new Set(["prompts/get", "resources/read"])
const unimplementedMethods: ReadonlySet<string> = new Set([
  "logging/setLevel",
  "resources/subscribe",
  "resources/unsubscribe"
])

const handleBaselineMethod = (
  id: JsonRpcId,
  method: string,
  params: unknown
): HttpServerResponse.HttpServerResponse | undefined => {
  const handler = baselineMethodHandlers.get(method)
  if (handler !== undefined) return handler(id, params)
  if (unavailableMethods.has(method)) return invalidParams(id)
  return unimplementedMethods.has(method) ? jsonRpcError(id, internalErrorCode, "Not implemented") : undefined
}

const handleRequest = (
  request: Schema.Schema.Type<typeof JsonRpcRequestSchema>,
  operations: VoilaOperations["Service"],
  version: string
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  const { id, method, params } = request
  const baselineResponse = handleBaselineMethod(id, method, params)
  if (baselineResponse !== undefined) return Effect.succeed(baselineResponse)

  switch (method) {
    case "initialize":
      return Effect.succeed(handleInitialize(id, params, version))
    case "tools/list":
      return Effect.succeed(handleListTools(id, params))
    case "tools/call":
      return handleCallTool(id, params, operations)
    default:
      return Effect.succeed(jsonRpcError(id, methodNotFoundCode, `Method not found: ${method}`))
  }
}

const handleJsonRpc = (
  raw: unknown,
  operations: VoilaOperations["Service"],
  version: string
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (Array.isArray(raw)) {
    return Effect.succeed(HttpServerResponse.empty({ status: badRequestStatus }))
  }

  if (isNotification(raw)) {
    // RC.110's HTTP adapter turns the empty response for a notification into
    // 202 Accepted. Notifications intentionally do not carry a JSON-RPC id or
    // a response body, but still need an HTTP response so the request can end.
    return Effect.succeed(HttpServerResponse.empty({ status: 202 }))
  }

  const request = Schema.decodeUnknownResult(JsonRpcRequestSchema)(raw)
  if (Result.isFailure(request)) {
    return Effect.succeed(invalidRequest())
  }

  return handleRequest(request.success, operations, version)
}

const statelessMcpRoute = (path: HttpRouter.PathInput, version: string) =>
  HttpRouter.add(
    "POST",
    path,
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      mediaTypes(request.headers["content-type"])[0] !== "application/json"
        ? Effect.succeed(HttpServerResponse.empty({ status: 415 }))
        : !mediaTypes(request.headers.accept).includes("application/json") ||
            !mediaTypes(request.headers.accept).includes("text/event-stream")
          ? Effect.succeed(HttpServerResponse.empty({ status: 406 }))
          : Effect.flatMap(VoilaOperations, (operations) =>
              Effect.matchEffect(request.json, {
                onFailure: () => Effect.succeed(invalidRequest()),
                onSuccess: (raw) => handleJsonRpc(raw, operations, version)
              })
            )
    )
  )

const unsupportedMcpMethodRoutes = (path: HttpRouter.PathInput) =>
  Layer.mergeAll(
    HttpRouter.add("GET", path, methodNotAllowedResponse),
    HttpRouter.add("PUT", path, methodNotAllowedResponse),
    HttpRouter.add("PATCH", path, methodNotAllowedResponse),
    HttpRouter.add("DELETE", path, methodNotAllowedResponse),
    HttpRouter.add("OPTIONS", path, methodNotAllowedResponse)
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
  HttpRouter.serve(Layer.mergeAll(healthRoutes, unsupportedMcpMethodRoutes(path), statelessMcpRoute(path, version)), {
    middleware: originGuard
  })

export const voilaHttpServerLayer = (
  options: VoilaMcpHttpServerOptions,
  version: string = packageVersion
): Layer.Layer<never, ServeError, VoilaOperations> =>
  Layer.provide(
    voilaMcpRoutesLayer(options.path ?? defaultHttpPath, version),
    NodeHttpServer.layer(createServer, { host: options.host, port: options.port })
  )
