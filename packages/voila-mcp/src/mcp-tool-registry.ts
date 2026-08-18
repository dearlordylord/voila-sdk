import { Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/unstable/ai"

import type { VoilaOperationName } from "./operation-descriptors.js"
import {
  type OperationEnvironment,
  type OperationExecutionFailure,
  OperationExecutionSuccessSchema,
  runVoilaOperation
} from "./operations.js"
import { VoilaOperations, voilaMcpTools, voilaToolkit } from "./mcp-toolkit.js"

const internalToolErrorMessage = "Tool execution failed due to an internal server error."

const toolErrorResult = (message: string): McpSchema.CallToolResult =>
  new McpSchema.CallToolResult({ content: [{ text: message, type: "text" }], isError: true })

const toolFailureResult = (failure: OperationExecutionFailure): McpSchema.CallToolResult =>
  new McpSchema.CallToolResult({
    content: [{ text: JSON.stringify(failure), type: "text" }],
    isError: true,
    structuredContent: failure
  })

const invalidToolInputResult = (
  name: VoilaOperationName,
  payload: unknown,
  error: Schema.SchemaError
): McpSchema.CallToolResult => {
  const structured = {
    module: "Toolkit",
    method: `${name}.handle`,
    description: `Failed to decode tool call parameters for tool '${name}' from:\n'${JSON.stringify(payload, null, 2)}'`,
    cause: { _id: "ParseError", message: error.message },
    _tag: "MalformedOutput",
    "~@effect/ai/AiError": "~@effect/ai/AiError"
  }
  return new McpSchema.CallToolResult({
    content: [{ text: JSON.stringify(structured), type: "text" }],
    isError: true,
    structuredContent: structured
  })
}

/** Executes a projected tool without depending on a transport client/session facade. */
export const executeVoilaTool = (
  name: VoilaOperationName,
  payload: unknown,
  operations: OperationEnvironment
): Effect.Effect<McpSchema.CallToolResult> => {
  const tool = voilaToolkit.tools[name]
  return Schema.decodeUnknownEffect(tool.parametersSchema)(payload).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.succeed(invalidToolInputResult(name, payload, error)),
      onSuccess: (parsed) =>
        Effect.matchEffect(runVoilaOperation(name, parsed, operations), {
          onFailure: (failure) => Effect.succeed(toolFailureResult(failure)),
          onSuccess: (success) =>
            Effect.map(
              Schema.encodeUnknownEffect(OperationExecutionSuccessSchema)(success).pipe(Effect.orDie),
              (encoded) =>
                new McpSchema.CallToolResult({
                  content: [{ text: JSON.stringify(encoded), type: "text" }],
                  isError: false,
                  structuredContent: encoded
                })
            )
        })
    }),
    Effect.catchDefect(() => Effect.succeed(toolErrorResult(internalToolErrorMessage)))
  )
}

const registerVoilaTools = Effect.gen(function* () {
  const registry = yield* McpServer.McpServer
  const operations = yield* VoilaOperations

  for (const record of voilaMcpTools) {
    yield* registry.addTool({
      annotations: record.annotations,
      tool: record.tool,
      handle: (payload: unknown) =>
        Effect.flatMap(McpSchema.McpServerClient, () => executeVoilaTool(record.name, payload, operations))
    })
  }
})

/** Shared registry for native MCP transports; HTTP uses the same records directly. */
export const voilaMcpRegistryLayer: Layer.Layer<never, never, McpServer.McpServer | VoilaOperations> =
  Layer.effectDiscard(registerVoilaTools)
