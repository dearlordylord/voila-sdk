import { NodeRuntime } from "@effect/platform-node"
import { Cause, Effect, Exit, Fiber, Layer, Result, Schema } from "effect"
import type { HttpRouter } from "effect/unstable/http"
import type { ServeError } from "effect/unstable/http/HttpServerError"

import { voilaHttpServerLayer } from "./mcp-http-server.js"
import { voilaStdioServerLayer, VoilaOperations } from "./mcp-server.js"
import { makeNodeOperationEnvironment } from "./node-env.js"
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

const RuntimeEnvSchema = Schema.Struct({
  MCP_HTTP_HOST: Schema.Trimmed.check(Schema.isNonEmpty()).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(defaultHttpHost))
  ),
  MCP_HTTP_PATH: HttpPathSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(defaultHttpPath))),
  MCP_HTTP_PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty())),
  MCP_TRANSPORT: Schema.Literals(["stdio", "http"]).pipe(Schema.withDecodingDefaultType(Effect.succeed("stdio"))),
  PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty()))
})

interface RuntimeConfig {
  readonly httpHost: string
  readonly httpPath: HttpRouter.PathInput
  readonly httpPort: number
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

  return Result.succeed({
    httpHost: decoded.success.MCP_HTTP_HOST,
    httpPath: decoded.success.MCP_HTTP_PATH,
    httpPort: port.success,
    transport: decoded.success.MCP_TRANSPORT
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

const runServer = <R>(serverLayer: Layer.Layer<never, ServeError, R>): Effect.Effect<void, ServeError, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const serverFiber = yield* Effect.forkChild(Layer.launch(serverLayer))
      const serverExit = yield* Fiber.await(serverFiber)

      if (Exit.isSuccess(serverExit) || Cause.hasInterruptsOnly(serverExit.cause)) return

      return yield* Effect.failCause(serverExit.cause)
    })
  )

/**
 * The process is one layer, launched. Shutdown on SIGINT/SIGTERM, finalizer
 * ordering, and non-zero exit on failure all come from the Effect runtime
 * rather than from hand-rolled signal handlers.
 */
const main = Effect.gen(function* () {
  const runtime = makeRuntimeConfig()
  const env = makeNodeOperationEnvironment()

  if (Result.isFailure(runtime)) {
    return yield* reportStartupFailure(runtime.failure)
  }

  if (Result.isFailure(env)) {
    return yield* reportStartupFailure(env.failure)
  }

  return yield* runServer(Layer.provide(makeServerLayer(runtime.success), Layer.succeed(VoilaOperations, env.success)))
})

NodeRuntime.runMain(main)
