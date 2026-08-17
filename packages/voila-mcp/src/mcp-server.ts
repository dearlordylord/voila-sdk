import { McpServer } from "@effect/ai"
import { NodeSink, NodeStream } from "@effect/platform-node"
import { Layer } from "effect"
import type { Sink, Stream } from "effect"

import { type VoilaOperations, voilaToolkit, voilaToolkitLayer } from "./mcp-toolkit.js"
import { mcpName, type VoilaOperationName, voilaOperationDescriptors } from "./operation-descriptors.js"
import { packageVersion } from "./package-version.js"

export { VoilaOperations } from "./mcp-toolkit.js"

/**
 * The tools, with their handlers, ready to be attached to whichever transport
 * the process runs. What is left unprovided is the operation environment: a
 * server layer says how tool calls travel, not what account they run against.
 */
export const voilaToolsLayer: Layer.Layer<never, never, VoilaOperations> = McpServer.toolkit(voilaToolkit).pipe(
  Layer.provide(voilaToolkitLayer)
)

export interface VoilaStdioStreams {
  readonly stdin: Stream.Stream<Uint8Array, unknown, never>
  readonly stdout: Sink.Sink<unknown, Uint8Array | string, unknown, unknown, never>
}

const stdioStreamFailure = (): Error => new Error("Voila MCP stdio stream failed")

const processStdio = (): VoilaStdioStreams => ({
  stdin: NodeStream.fromReadable(() => process.stdin, stdioStreamFailure),
  stdout: NodeSink.fromWritable(() => process.stdout, stdioStreamFailure)
})

/**
 * The stdio server. The streams are a parameter rather than `process.stdin`
 * baked in, because a protocol test drives the real server over a pipe pair —
 * spawning a child process to find out whether a tool is listed is a slower
 * way to learn less.
 */
export const voilaStdioServerLayer = (
  streams: VoilaStdioStreams = processStdio(),
  version: string = packageVersion
): Layer.Layer<never, never, VoilaOperations> =>
  voilaToolsLayer.pipe(
    Layer.provide(McpServer.layerStdio({ name: mcpName, stdin: streams.stdin, stdout: streams.stdout, version }))
  )

export const isVoilaOperationName = (name: string): name is VoilaOperationName =>
  voilaOperationDescriptors.some((operation) => operation.name === name)
