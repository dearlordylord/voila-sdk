import type { HttpRouter } from "@effect/platform"
import type { ServeError } from "@effect/platform/HttpServerError"
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Either, Layer, Schema } from "effect"

import { voilaHttpServerLayer } from "./mcp-http-server.js"
import { voilaStdioServerLayer, VoilaOperations } from "./mcp-server.js"
import { makeNodeOperationEnvironment } from "./node-env.js"
import { packageVersion } from "./package-version.js"

const defaultHttpHost = "127.0.0.1"
// the router's own path type: a route that does not start with "/" is not a
// path the server can mount, and that is a startup failure, not a 404
const HttpPathSchema = Schema.TemplateLiteral("/", Schema.String)
const defaultHttpPath: HttpRouter.PathInput = "/mcp"
const defaultHttpPort = 3000
const decimalRadix = 10
const maxTcpPort = 65_535
const minTcpPort = 1

const RuntimeEnvSchema = Schema.Struct({
  MCP_HTTP_HOST: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    default: () => defaultHttpHost
  }),
  MCP_HTTP_PATH: Schema.optionalWith(HttpPathSchema, { default: () => defaultHttpPath }),
  MCP_HTTP_PORT: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), { exact: true }),
  MCP_TRANSPORT: Schema.optionalWith(Schema.Literal("stdio", "http"), { default: () => "stdio" }),
  PORT: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), { exact: true })
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

const parsePort = (value: string | undefined): Either.Either<number, RuntimeConfigFailure> => {
  if (value === undefined) {
    return Either.right(defaultHttpPort)
  }

  const parsed = Number.parseInt(value, decimalRadix)

  if (!Number.isInteger(parsed) || parsed < minTcpPort || parsed > maxTcpPort || String(parsed) !== value) {
    return Either.left(runtimeConfigFailure("MCP_HTTP_PORT or PORT must be an integer TCP port"))
  }

  return Either.right(parsed)
}

const makeRuntimeConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env
): Either.Either<RuntimeConfig, RuntimeConfigFailure> => {
  const decoded = Either.mapLeft(Schema.decodeUnknownEither(RuntimeEnvSchema)(env), () =>
    runtimeConfigFailure("Voila MCP runtime environment variables are invalid")
  )

  if (Either.isLeft(decoded)) {
    return Either.left(decoded.left)
  }

  const port = parsePort(decoded.right.MCP_HTTP_PORT ?? decoded.right.PORT)

  if (Either.isLeft(port)) {
    return Either.left(port.left)
  }

  return Either.right({
    httpHost: decoded.right.MCP_HTTP_HOST,
    httpPath: decoded.right.MCP_HTTP_PATH,
    httpPort: port.right,
    transport: decoded.right.MCP_TRANSPORT
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

/**
 * The process is one layer, launched. Shutdown on SIGINT/SIGTERM, finalizer
 * ordering, and non-zero exit on failure all come from the Effect runtime
 * rather than from hand-rolled signal handlers.
 */
const main = Effect.gen(function* () {
  const runtime = makeRuntimeConfig()
  const env = makeNodeOperationEnvironment()

  if (Either.isLeft(runtime)) {
    return yield* reportStartupFailure(runtime.left)
  }

  if (Either.isLeft(env)) {
    return yield* reportStartupFailure(env.left)
  }

  return yield* Layer.launch(Layer.provide(makeServerLayer(runtime.right), Layer.succeed(VoilaOperations, env.right)))
})

NodeRuntime.runMain(main)
