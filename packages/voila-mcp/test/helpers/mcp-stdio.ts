import { NodeSink, NodeStream } from "@effect/platform-node"
import { Effect, Layer, Queue, type Scope, Stream } from "effect"
import { PassThrough } from "node:stream"

import type { VoilaOperations } from "../../src/mcp-server.js"
import { voilaStdioServerLayer } from "../../src/mcp-server.js"

const streamFailure = (): Error => new Error("Voila MCP stdio test stream failed")

export interface StdioClient {
  /** Sends one JSON-RPC message and reads the next line the server writes. */
  readonly exchange: (message: unknown) => Effect.Effect<unknown>
  /** Sends one JSON-RPC notification, which the server does not answer. */
  readonly notify: (message: unknown) => Effect.Effect<void>
}

/**
 * The real stdio server, driven in process over a pipe pair. A child process
 * would prove the same thing about the protocol and much less about the code
 * under test, several seconds slower.
 */
export const stdioClient = (operations: Layer.Layer<VoilaOperations>): Effect.Effect<StdioClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const toServer = new PassThrough()
    const fromServer = new PassThrough()
    const lines = yield* Queue.unbounded<string>()

    const server = voilaStdioServerLayer({
      stdin: NodeStream.fromReadable(() => toServer, streamFailure),
      stdout: NodeSink.fromWritable(() => fromServer, streamFailure)
    }).pipe(Layer.provide(operations))

    yield* Effect.forkScoped(Layer.launch(server))
    yield* Effect.forkScoped(
      NodeStream.fromReadable<Error, Uint8Array>(() => fromServer, streamFailure).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim().length > 0),
        Stream.runForEach((line) => Queue.offer(lines, line)),
        Effect.orDie
      )
    )

    const send = (message: unknown) =>
      Effect.sync(() => {
        toServer.write(`${JSON.stringify(message)}\n`)
      })

    return {
      exchange: (message: unknown) =>
        Effect.flatMap(
          Effect.zipRight(send(message), Queue.take(lines)),
          (line): Effect.Effect<unknown> => Effect.sync(() => JSON.parse(line))
        ),
      notify: send
    }
  })
