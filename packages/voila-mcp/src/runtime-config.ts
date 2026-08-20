import {
  KeepaliveIntervalSecondsSchema,
  keepaliveIntervalMsFromSeconds,
  type KeepaliveHealthyIntervalMs
} from "@firfi/voila-sdk"
import type { HttpRouter } from "effect/unstable/http"
import { Effect, Result, Schema, SchemaGetter } from "effect"

import type { KeepaliveOperatorMode } from "./startup-config.js"

const defaultHttpHost = "127.0.0.1"
const defaultHttpPath: HttpRouter.PathInput = "/mcp"
const defaultHttpPort = 3000

const HttpPathSchema = Schema.TemplateLiteral(["/", Schema.String])
const maxTcpPort = 65_535
const minTcpPort = 1

export const HttpHostSchema = Schema.Trimmed.check(Schema.isNonEmpty()).pipe(Schema.brand("HttpHost"))
export type HttpHost = Schema.Schema.Type<typeof HttpHostSchema>

export const TcpPortSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(minTcpPort)),
  Schema.check(Schema.isLessThanOrEqualTo(maxTcpPort)),
  Schema.brand("TcpPort")
)

export type TcpPort = Schema.Schema.Type<typeof TcpPortSchema>

const TcpPortFromStringSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/)),
  Schema.decodeTo(TcpPortSchema, { decode: SchemaGetter.transform(Number), encode: SchemaGetter.transform(String) })
)

export const RuntimeEnvSchema = Schema.Struct({
  MCP_HTTP_HOST: HttpHostSchema.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(HttpHostSchema.make(defaultHttpHost)))
  ),
  MCP_HTTP_PATH: HttpPathSchema.pipe(Schema.withDecodingDefaultType(Effect.succeed(defaultHttpPath))),
  MCP_HTTP_PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty())),
  MCP_TRANSPORT: Schema.Literals(["stdio", "http"]).pipe(Schema.withDecodingDefaultType(Effect.succeed("stdio"))),
  PORT: Schema.optionalKey(Schema.Trimmed.check(Schema.isNonEmpty())),
  VOILA_KEEPALIVE: Schema.optionalKey(Schema.Literal("0")),
  VOILA_KEEPALIVE_INTERVAL_SECONDS: Schema.optionalKey(KeepaliveIntervalSecondsSchema)
})

type RuntimeEnvironment = Schema.Schema.Type<typeof RuntimeEnvSchema>

const RuntimeConfigFailureSchema = Schema.TaggedStruct("VoilaMcpRuntimeEnvironmentInvalid", { message: Schema.String })

type RuntimeConfigFailure = Schema.Schema.Type<typeof RuntimeConfigFailureSchema>

export interface RuntimeConfig {
  readonly httpHost: HttpHost
  readonly httpPath: HttpRouter.PathInput
  readonly httpPort: TcpPort
  readonly keepaliveMode: KeepaliveOperatorMode
  readonly keepaliveIntervalMs: KeepaliveHealthyIntervalMs | undefined
  readonly transport: "http" | "stdio"
}

const runtimeConfigFailure = (message: string): RuntimeConfigFailure => ({
  _tag: "VoilaMcpRuntimeEnvironmentInvalid",
  message
})

const parsePort = (value: string | undefined): Result.Result<TcpPort, RuntimeConfigFailure> => {
  if (value === undefined) {
    return Result.succeed(TcpPortSchema.make(defaultHttpPort))
  }

  return Result.mapError(Schema.decodeUnknownResult(TcpPortFromStringSchema)(value), () =>
    runtimeConfigFailure("MCP_HTTP_PORT or PORT must be an integer TCP port")
  )
}

const parseInterval = (
  value: RuntimeEnvironment["VOILA_KEEPALIVE_INTERVAL_SECONDS"]
): KeepaliveHealthyIntervalMs | undefined => {
  if (value === undefined) {
    return undefined
  }

  return keepaliveIntervalMsFromSeconds(value)
}

export const makeRuntimeConfig = (
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

  const interval = parseInterval(decoded.success.VOILA_KEEPALIVE_INTERVAL_SECONDS)

  return Result.succeed({
    httpHost: decoded.success.MCP_HTTP_HOST,
    httpPath: decoded.success.MCP_HTTP_PATH,
    httpPort: port.success,
    keepaliveMode: decoded.success.VOILA_KEEPALIVE === "0" ? "disabled" : "enabled",
    keepaliveIntervalMs: interval,
    transport: decoded.success.MCP_TRANSPORT
  })
}
