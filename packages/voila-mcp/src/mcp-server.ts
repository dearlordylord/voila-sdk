import { NodeStdio } from "@effect/platform-node"
import { Effect, Layer, Sink, Stdio } from "effect"
import type { Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { McpProtocol, McpServer } from "effect/unstable/ai"

import { voilaMcpRegistryLayer } from "./mcp-tool-registry.js"
import type { VoilaOperations } from "./mcp-toolkit.js"
import { mcpName, type VoilaOperationName, voilaOperationDescriptors } from "./operation-descriptors.js"
import { packageVersion } from "./package-version.js"

export { VoilaOperations } from "./mcp-toolkit.js"

/**
 * The tools, with their handlers, ready to be attached to whichever transport
 * the process runs. What is left unprovided is the operation environment: a
 * server layer says how tool calls travel, not what account they run against.
 */
export const voilaToolsLayer: Layer.Layer<never, never, McpServer.McpServer | VoilaOperations> = voilaMcpRegistryLayer

export interface VoilaStdioStreams {
  readonly stdin: Stream.Stream<Uint8Array, PlatformError>
  readonly stdout: Sink.Sink<void, Uint8Array | string, never, PlatformError>
}

const streamsLayer = (streams: VoilaStdioStreams): Layer.Layer<Stdio.Stdio> =>
  Layer.succeed(
    Stdio.Stdio,
    Stdio.make({
      args: Effect.succeed(process.argv.slice(2)),
      stderr: () => Sink.drain,
      stdin: streams.stdin,
      stdout: () => streams.stdout
    })
  )

/**
 * The stdio server. The streams are a parameter rather than `process.stdin`
 * baked in, because a protocol test drives the real server over a pipe pair —
 * spawning a child process to find out whether a tool is listed is a slower
 * way to learn less.
 */
export const voilaStdioServerLayer = (
  streams?: VoilaStdioStreams,
  version: string = packageVersion
): Layer.Layer<never, never, VoilaOperations> =>
  voilaToolsLayer.pipe(
    Layer.provide(
      McpServer.layerStdio({ name: mcpName, protocols: [McpProtocol.v2025_06_18], version }).pipe(Layer.orDie)
    ),
    Layer.provide(streams === undefined ? NodeStdio.layer : streamsLayer(streams))
  )

export const isVoilaOperationName = (name: string): name is VoilaOperationName =>
  voilaOperationDescriptors.some((operation) => operation.name === name)
