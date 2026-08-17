import { HttpBody, HttpClient, HttpClientRequest } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"

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
          body: HttpBody.unsafeJson(body),
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

export const getJson = (
  path: string
): Effect.Effect<{ readonly body: unknown; readonly status: number }, unknown, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.get(path).pipe(
      Effect.flatMap((response) => Effect.map(response.json, (body) => ({ body, status: response.status }))),
      Effect.scoped
    )
  )
