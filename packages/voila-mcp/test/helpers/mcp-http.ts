import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"

import { voilaMcpRoutesLayer } from "../../src/mcp-http-server.js"
import type { VoilaOperations } from "../../src/mcp-server.js"

const mcpPath = "/mcp"

/**
 * The server under test, served to an in-process client. No socket, no port to
 * pick, no cleanup to forget — and the same routes and the same JSON-RPC
 * handling a deployed process serves.
 */
export const testServerLayer = (operations: Layer.Layer<VoilaOperations>): Layer.Layer<HttpClient.HttpClient> =>
  Layer.provideMerge(voilaMcpRoutesLayer(mcpPath), NodeHttpServer.layerTest).pipe(
    Layer.provide(operations),
    Layer.orDie
  )

export const jsonRpc = (
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): Effect.Effect<unknown, unknown, HttpClient.HttpClient> =>
  Effect.map(jsonRpcResponse(body, headers), (response) => response.body)

/**
 * The status as well as the body: an origin the server refuses never reaches
 * JSON-RPC, so a test that only reads the body cannot tell a refusal from a
 * reply.
 */
export const jsonRpcResponse = (
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): Effect.Effect<{ readonly body: unknown; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client
      .execute(
        HttpClientRequest.post(mcpPath, {
          body: HttpBody.jsonUnsafe(body),
          headers: { accept: "application/json, text/event-stream", ...headers }
        })
      )
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.json, (parsed) => ({ body: parsed, status: response.status }))
        ),
        Effect.scoped
      )
  )

export const jsonRpcTextResponse = (
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): Effect.Effect<{ readonly body: string; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client
      .execute(
        HttpClientRequest.post(mcpPath, {
          body: HttpBody.jsonUnsafe(body),
          headers: { accept: "application/json, text/event-stream", ...headers }
        })
      )
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.text, (bodyText) => ({ body: bodyText, status: response.status }))
        ),
        Effect.scoped
      )
  )

export const rawMcpResponse = (
  body: string,
  headers: Readonly<Record<string, string>> = {},
  contentType = "application/json"
): Effect.Effect<{ readonly body: string; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client
      .execute(
        HttpClientRequest.post(mcpPath, {
          body: HttpBody.text(body, contentType),
          headers: { accept: "application/json, text/event-stream", ...headers }
        })
      )
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.text, (bodyText) => ({ body: bodyText, status: response.status }))
        ),
        Effect.scoped
      )
  )

export const emptyMcpResponse = (): Effect.Effect<
  { readonly body: string; readonly status: number },
  unknown,
  HttpClient.HttpClient
> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client
      .execute(HttpClientRequest.post(mcpPath, { headers: { accept: "application/json, text/event-stream" } }))
      .pipe(
        Effect.flatMap((response) => Effect.map(response.text, (body) => ({ body, status: response.status }))),
        Effect.scoped
      )
  )

export const unsupportedMethodResponse = (
  method: "DELETE" | "GET" | "OPTIONS" | "PATCH" | "PUT"
): Effect.Effect<{ readonly body: string; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client
      .execute(HttpClientRequest.make(method)(mcpPath, { headers: { accept: "application/json, text/event-stream" } }))
      .pipe(
        Effect.flatMap((response) => Effect.map(response.text, (body) => ({ body, status: response.status }))),
        Effect.scoped
      )
  )

export const getJson = (
  path: string
): Effect.Effect<{ readonly body: unknown; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.get(path).pipe(
      Effect.flatMap((response) => Effect.map(response.json, (body) => ({ body, status: response.status }))),
      Effect.scoped
    )
  )
