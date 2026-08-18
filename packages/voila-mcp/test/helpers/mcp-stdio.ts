import { NodeSink, NodeStream } from "@effect/platform-node"
import { Effect, Layer, Queue, type Scope, Stream } from "effect"
import { badArgument, type PlatformError } from "effect/PlatformError"
import { PassThrough } from "node:stream"

import type { VoilaOperations } from "../../src/mcp-server.js"
import { voilaStdioServerLayer } from "../../src/mcp-server.js"

const streamFailure = (): PlatformError =>
  badArgument({ description: "Voila MCP stdio test stream failed", method: "stdio", module: "voila-mcp-test" })

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
      stdin: NodeStream.fromReadable({ evaluate: () => toServer, onError: streamFailure }),
      stdout: NodeSink.fromWritable({ evaluate: () => fromServer, onError: streamFailure })
    }).pipe(Layer.provide(operations))

    yield* Layer.launch(server).pipe(Effect.forkScoped)
    yield* NodeStream.fromReadable<Uint8Array, PlatformError>({ evaluate: () => fromServer, onError: streamFailure })
      .pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim().length > 0),
        Stream.runForEach((line) => Queue.offer(lines, line)),
        Effect.orDie
      )
      .pipe(Effect.forkScoped)

    const send = (message: unknown) =>
      Effect.sync(() => {
        toServer.write(`${JSON.stringify(message)}\n`)
      })

    return {
      exchange: (message: unknown) =>
        Effect.flatMap(send(message), () => Effect.map(Queue.take(lines), (line) => JSON.parse(line))),
      notify: send
    }
  })
