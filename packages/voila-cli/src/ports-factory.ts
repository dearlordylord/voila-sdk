import {
  makeKeepaliveConfig,
  makeNodeOperationEnvironment,
  type OperationEnvironment,
  type OperationExecutionResult,
  type OperationFailure,
  runKeepalive,
  runVoilaOperation
} from "@firfi/voila-mcp"
import { type KeepaliveConfig, keepaliveIntervalMsFromSeconds, type KeepaliveStopReason } from "@firfi/voila-sdk"
import { Effect, Result } from "effect"

import { loginWithPlaywright } from "./auth-login.js"
import type { CliDelay, CliKeepaliveOptions, CliOperationOptions, CliPorts, CliStderrWriter } from "./cli-model.js"

export interface NodeCliRuntime {
  readonly makeEnvironment: (
    env: Readonly<Record<string, string | undefined>>
  ) => Result.Result<OperationEnvironment, OperationFailure>
  readonly runOperation: (
    name: Parameters<CliPorts["runOperation"]>[0],
    input: unknown,
    env: OperationEnvironment
  ) => Promise<OperationExecutionResult>
  readonly runKeepalive: (env: OperationEnvironment, config: KeepaliveConfig) => Promise<KeepaliveStopReason>
  readonly login: CliPorts["login"]
  readonly delay: CliDelay
  readonly writeStderr: CliStderrWriter
}

type OperationRunner = (
  name: Parameters<CliPorts["runOperation"]>[0],
  input: unknown,
  env: OperationEnvironment
) => Effect.Effect<OperationExecutionResult, OperationExecutionResult>

const envFailure = (tag: string, message: string): OperationExecutionResult => ({
  error: { _tag: tag, message },
  ok: false
})

export const makeProductionRuntime = (
  operation: OperationRunner = runVoilaOperation,
  keepalive: typeof runKeepalive = runKeepalive
): NodeCliRuntime => ({
  makeEnvironment: makeNodeOperationEnvironment,
  runOperation: async (name, input, env) => {
    const executed = await Effect.runPromise(Effect.result(operation(name, input, env)))

    return Result.isFailure(executed) ? executed.failure : executed.success
  },
  runKeepalive: (env, config) => keepalive(env, config),
  login: loginWithPlaywright,
  delay: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    }),
  writeStderr: (message) => void process.stderr.write(message)
})

const runNodeOperation = async (
  runtime: NodeCliRuntime,
  name: Parameters<CliPorts["runOperation"]>[0],
  input: unknown,
  options: CliOperationOptions
): Promise<OperationExecutionResult> => {
  // the environment boundary is an environment-variable map, so the parsed
  // path travels through it as the string it already is
  const env = runtime.makeEnvironment({ VOILA_AUTH_SESSION_PATH: options.sessionPath })

  if (Result.isFailure(env)) {
    return envFailure(env.failure._tag, env.failure.message)
  }

  return runtime.runOperation(name, input, env.success)
}

const runNodeKeepalive = async (
  runtime: NodeCliRuntime,
  options: CliKeepaliveOptions
): Promise<KeepaliveStopReason> => {
  const env = runtime.makeEnvironment({ VOILA_AUTH_SESSION_PATH: options.sessionPath })

  if (Result.isFailure(env)) {
    return "misconfigured"
  }

  const intervalMs =
    options.intervalSeconds === undefined ? undefined : keepaliveIntervalMsFromSeconds(options.intervalSeconds)

  const config = makeKeepaliveConfig({
    expiryPolicy: "stop",
    ...(intervalMs === undefined ? {} : { healthyIntervalMs: intervalMs })
  })

  return Result.isFailure(config) ? "misconfigured" : runtime.runKeepalive(env.success, config.success)
}

export const makeNodeCliPorts = (runtime: NodeCliRuntime = makeProductionRuntime()): CliPorts => ({
  delay: runtime.delay,
  keepalive: (options) => runNodeKeepalive(runtime, options),
  login: runtime.login,
  runOperation: (name, input, options) => runNodeOperation(runtime, name, input, options),
  writeStderr: runtime.writeStderr
})
