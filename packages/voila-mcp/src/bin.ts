import { NodeRuntime } from "@effect/platform-node"
import { Cause, Effect, Exit, Fiber, Layer, Result, Schema } from "effect"
import type { ServeError } from "effect/unstable/http/HttpServerError"

import { runKeepaliveLoop } from "./keepalive-runner.js"
import { voilaHttpServerLayer } from "./mcp-http-server.js"
import { voilaStdioServerLayer, VoilaOperations } from "./mcp-server.js"
import { makeNodeOperationEnvironmentFromConfig } from "./node-env.js"
import { type OperationEnvironment } from "./operations.js"
import { packageVersion } from "./package-version.js"
import {
  keepaliveEligibilityFor,
  NodeEnvironmentSchema,
  keepaliveStartupStateFor,
  KeepaliveStartupStateSchema,
  type KeepaliveStartupState,
  type NodeEnvironmentConfig
} from "./startup-config.js"
import { makeRuntimeConfig, type RuntimeConfig } from "./runtime-config.js"
import { type KeepaliveConfig } from "./index.js"

const millisecondsPerSecond = 1_000

const writeStderr = (line: string): void => {
  process.stderr.write(line)
}

const makeServerLayer = (runtime: RuntimeConfig): Layer.Layer<never, ServeError, VoilaOperations> =>
  runtime.transport === "http"
    ? voilaHttpServerLayer({ host: runtime.httpHost, path: runtime.httpPath, port: runtime.httpPort }, packageVersion)
    : voilaStdioServerLayer(undefined, packageVersion)

const reportStartupFailure = (failure: { readonly _tag: string; readonly message: string }): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(`${failure._tag}: ${failure.message}\n`)
    process.exitCode = 1
  })

const keepaliveEffect = (env: OperationEnvironment, config: KeepaliveConfig): Effect.Effect<void, never, never> =>
  // Defects are logged to stderr rather than crashing the process: a keepalive
  // defect must not take the server down with it. The message stays generic on
  // purpose — a defect can carry anything, and the stderr log is not the place
  // to find out whether it carried a secret.
  runKeepaliveLoop(env, config, writeStderr).pipe(
    Effect.provide(env.transport),
    Effect.catchDefect(() => Effect.sync(() => writeStderr("voila keepalive stopped unexpectedly\n"))),
    Effect.ignore
  )

/**
 * The process is one layer, launched. The keepalive loop is a child fiber of
 * the same scope: when the server exits — stdio client disconnect, SIGINT, or a
 * launch failure — the scope finalizes and the keepalive fiber is interrupted
 * at its next `Effect.sleep`, so no `setTimeout` is left pinning the process.
 * Shutdown, finalizer ordering, and non-zero exit come from the Effect runtime
 * rather than from hand-rolled signal handlers.
 */
const runServer = (
  runtime: RuntimeConfig,
  env: OperationEnvironment,
  startupState: KeepaliveStartupState
): Effect.Effect<void, ServeError> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* KeepaliveStartupStateSchema.match(startupState, {
        disabled: () => Effect.sync(() => writeStderr("voila keepalive: skipped (disabled via VOILA_KEEPALIVE=0)\n")),
        ineligible: ({ reason }) => Effect.sync(() => writeStderr(`voila keepalive: skipped (${reason})\n`)),
        enabled: ({ config }) =>
          Effect.gen(function* () {
            writeStderr(`voila keepalive: started (interval: ${config.healthyIntervalMs / millisecondsPerSecond}s)\n`)
            yield* Effect.forkChild(keepaliveEffect(env, config))
          })
      })

      const serverFiber = yield* Effect.forkChild(
        Layer.launch(Layer.provide(makeServerLayer(runtime), Layer.succeed(VoilaOperations, env)))
      )
      const serverExit = yield* Fiber.await(serverFiber)

      if (Exit.isSuccess(serverExit) || Cause.hasInterruptsOnly(serverExit.cause)) return

      return yield* Effect.failCause(serverExit.cause)
    })
  )

const main = Effect.gen(function* () {
  const runtime = makeRuntimeConfig()
  const nodeEnvironment = Result.mapError(Schema.decodeUnknownResult(NodeEnvironmentSchema)(process.env), () => ({
    _tag: "VoilaEnvironmentInvalid",
    message: "Voila MCP environment variables are invalid"
  }))

  if (Result.isFailure(runtime)) {
    return yield* reportStartupFailure(runtime.failure)
  }

  if (Result.isFailure(nodeEnvironment)) {
    return yield* reportStartupFailure(nodeEnvironment.failure)
  }

  const env: NodeEnvironmentConfig = nodeEnvironment.success
  const startupInput =
    runtime.success.keepaliveIntervalMs === undefined
      ? { mode: runtime.success.keepaliveMode, eligibility: keepaliveEligibilityFor(env) }
      : {
          mode: runtime.success.keepaliveMode,
          eligibility: keepaliveEligibilityFor(env),
          healthyIntervalMs: runtime.success.keepaliveIntervalMs
        }
  const startupState = keepaliveStartupStateFor(startupInput)

  if (Result.isFailure(startupState)) {
    return yield* reportStartupFailure(startupState.failure)
  }

  return yield* runServer(runtime.success, makeNodeOperationEnvironmentFromConfig(env), startupState.success)
})

NodeRuntime.runMain(main)
