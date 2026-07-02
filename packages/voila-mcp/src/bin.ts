import { Either, Schema } from "effect"

import { startHttpServer } from "./mcp-http-server.js"
import { startStdioServer } from "./mcp-server.js"
import { makeNodeOperationEnvironment } from "./node-env.js"

const defaultHttpHost = "127.0.0.1"
const defaultHttpPath = "/mcp"
const defaultHttpPort = 3000
const decimalRadix = 10
const maxTcpPort = 65_535
const minTcpPort = 1

const RuntimeEnvSchema = Schema.Struct({
  MCP_HTTP_HOST: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    default: () => defaultHttpHost
  }),
  MCP_HTTP_PATH: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    default: () => defaultHttpPath
  }),
  MCP_HTTP_PORT: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    exact: true
  }),
  MCP_TRANSPORT: Schema.optionalWith(Schema.Literal("stdio", "http"), {
    default: () => "stdio"
  }),
  PORT: Schema.optionalWith(Schema.String.pipe(Schema.trimmed(), Schema.minLength(1)), {
    exact: true
  })
})

interface RuntimeConfig {
  readonly httpHost: string
  readonly httpPath: string
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
  const decoded = Either.mapLeft(
    Schema.decodeUnknownEither(RuntimeEnvSchema)(env),
    () => runtimeConfigFailure("Voila MCP runtime environment variables are invalid")
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

const waitForShutdown = async (): Promise<void> =>
  new Promise((resolve) => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })

const main = async (): Promise<void> => {
  const runtime = makeRuntimeConfig()
  const env = makeNodeOperationEnvironment()

  if (Either.isLeft(runtime)) {
    process.stderr.write(`${runtime.left._tag}: ${runtime.left.message}\n`)
    process.exitCode = 1

    return
  }

  if (Either.isLeft(env)) {
    process.stderr.write(`${env.left._tag}: ${env.left.message}\n`)
    process.exitCode = 1

    return
  }

  if (runtime.right.transport === "http") {
    const server = await startHttpServer(env.right, {
      host: runtime.right.httpHost,
      path: runtime.right.httpPath,
      port: runtime.right.httpPort
    })

    process.stderr.write(
      `Voila MCP HTTP server listening on ${runtime.right.httpHost}:${runtime.right.httpPort}${runtime.right.httpPath}\n`
    )
    await waitForShutdown()
    server.close()

    return
  }

  await startStdioServer(env.right)
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Voila MCP failed to start\n")
  process.exitCode = 1
})
