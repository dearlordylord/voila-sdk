import { NodeRuntime } from "@effect/platform-node"
import { type KeepaliveConfig, makeKeepaliveConfig } from "@firfi/voila-mcp"
import { Cause, Effect, Exit, Fiber, Layer, Result, Schema } from "effect"
import type { HttpRouter } from "effect/unstable/http"
import type { ServeError } from "effect/unstable/http/HttpServerError"

import { runKeepaliveLoop } from "./keepalive-runner.js"
import { voilaHttpServerLayer } from "./mcp-http-server.js"
import { voilaStdioServerLayer, VoilaOperations } from "./mcp-server.js"
import { makeNodeOperationEnvironment } from "./node-env.js"
import { type OperationEnvironment } from "./operations.js"
import { packageVersion } from "./package-version.js"

const defaultHttpHost = "127.0.0.1"
// the router's own path type: a route that does not start with "/" is not a
// path the server can mount, and that is a startup failure, not a 404
const HttpPathSchema = Schema.TemplateLiteral(["/", Schema.String])
const defaultHttpPath: HttpRouter.PathInput = "/mcp"
const defaultHttpPort = 3000
const decimalRadix = 10
const maxTcpPort = 65_535
const minTcpPort = 1
const minKeepaliveIntervalSeconds = 3_600
const millisecondsPerSecond = 1_000

const RuntimeEnvSchema = Schema.Struct({
  MCP_HTTP_HOST: Schema.Trimmed.check(Schema.isNonEmpty()).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(defaultHttpHost))
  ),
  MCP_HTTP_PATH: HttpPathSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(defaultHttpPath))),
  MCP_HTTP_PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty())),
  MCP_TRANSPORT: Schema.Literals(["stdio", "http"]).pipe(Schema.withDecodingDefaultType(Effect.succeed("stdio"))),
  PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty())),
  // Keepalive is opt-out: an authenticated session is eligible by default, and
  // `VOILA_KEEPALIVE=0` disables it. The interval lives at the env boundary so a
  // misconfiguration is a startup failure rather than a silent default.
  VOILA_KEEPALIVE: Schema.optionalKey(Schema.Literal("0")),
  VOILA_KEEPALIVE_INTERVAL_SECONDS: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty()))
})

interface RuntimeConfig {
  readonly httpHost: string
  readonly httpPath: HttpRouter.PathInput
  readonly httpPort: number
  readonly keepaliveDisabled: boolean
  readonly keepaliveIntervalMs: number | undefined
  readonly transport: "http" | "stdio"
}

interface RuntimeConfigFailure {
  readonly _tag: "VoilaMcpRuntimeEnvironmentInvalid"
  readonly message: string
}

const runtimeConfigFailure = (message: string): RuntimeConfigFailure => ({
  _tag: "VoilaMcpRuntimeEnvironmentInvalid",
  message
})

const parsePort = (value: string | undefined): Result.Result<number, RuntimeConfigFailure> => {
  if (value === undefined) {
    return Result.succeed(defaultHttpPort)
  }

  const parsed = Number.parseInt(value, decimalRadix)

  if (!Number.isInteger(parsed) || parsed < minTcpPort || parsed > maxTcpPort || String(parsed) !== value) {
    return Result.fail(runtimeConfigFailure("MCP_HTTP_PORT or PORT must be an integer TCP port"))
  }

  return Result.succeed(parsed)
}

const parseKeepaliveIntervalSeconds = (
  value: string | undefined
): Result.Result<number | undefined, RuntimeConfigFailure> => {
  if (value === undefined) {
    return Result.succeed(undefined)
  }

  const parsed = Number.parseInt(value, decimalRadix)

  if (!Number.isInteger(parsed) || parsed < minKeepaliveIntervalSeconds || String(parsed) !== value) {
    return Result.fail(
      runtimeConfigFailure(
        `VOILA_KEEPALIVE_INTERVAL_SECONDS must be an integer of at least ${minKeepaliveIntervalSeconds} seconds`
      )
    )
  }

  return Result.succeed(parsed)
}

const makeRuntimeConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Result.Result<RuntimeConfig, RuntimeConfigFailure> => {
  const decoded = Result.mapError(Schema.decodeUnknownResult(RuntimeEnvSchema)(env), () =>
    runtimeConfigFailure("Voila MCP runtime environment variables are invalid")
  )

  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }

  const port = parsePort(decoded.success.MCP_HTTP_PORT ?? decoded.success.PORT)

  if (Result.isFailure(port)) {
    return Result.fail(port.failure)
  }

  const intervalSeconds = parseKeepaliveIntervalSeconds(decoded.success.VOILA_KEEPALIVE_INTERVAL_SECONDS)

  if (Result.isFailure(intervalSeconds)) {
    return Result.fail(intervalSeconds.failure)
  }

  return Result.succeed({
    httpHost: decoded.success.MCP_HTTP_HOST,
    httpPath: decoded.success.MCP_HTTP_PATH,
    httpPort: port.success,
    keepaliveDisabled: decoded.success.VOILA_KEEPALIVE === "0",
    keepaliveIntervalMs:
      intervalSeconds.success === undefined ? undefined : intervalSeconds.success * millisecondsPerSecond,
    transport: decoded.success.MCP_TRANSPORT
  })
}

const writeStderr = (line: string): void => {
  process.stderr.write(line)
}

// Keepalive only makes sense for an authenticated session: a guest has no
// sliding-expiry auth to keep warm. The environment surfaces this as the
// presence of auth guidance — the same marker the CLI uses to print login help.
const keepaliveConfigFor = (runtime: RuntimeConfig, env: OperationEnvironment): KeepaliveConfig | undefined => {
  if (runtime.keepaliveDisabled || env.authGuidance === undefined) {
    return undefined
  }

  return makeKeepaliveConfig({
    ...(runtime.keepaliveIntervalMs === undefined ? {} : { healthyIntervalMs: runtime.keepaliveIntervalMs })
  })
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
const runServer = (runtime: RuntimeConfig, env: OperationEnvironment): Effect.Effect<void, ServeError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = keepaliveConfigFor(runtime, env)

      if (config === undefined) {
        writeStderr("voila keepalive: skipped (no authenticated session or disabled via VOILA_KEEPALIVE=0)\n")
      } else {
        writeStderr(`voila keepalive: started (interval: ${config.healthyIntervalMs / millisecondsPerSecond}s)\n`)
        yield* Effect.forkChild(keepaliveEffect(env, config))
      }

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
  const env = makeNodeOperationEnvironment()

  if (Result.isFailure(runtime)) {
    return yield* reportStartupFailure(runtime.failure)
  }

  if (Result.isFailure(env)) {
    return yield* reportStartupFailure(env.failure)
  }

  return yield* runServer(runtime.success, env.success)
})

NodeRuntime.runMain(main)
