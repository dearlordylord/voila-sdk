import {
  makeKeepaliveConfig,
  makeNodeOperationEnvironment,
  type OperationExecutionResult,
  runKeepalive,
  runVoilaOperation
} from "@firfi/voila-mcp"
import { type KeepaliveStopReason } from "@firfi/voila-sdk"
import { Effect, Result } from "effect"

import { access } from "node:fs/promises"

import { loginWithPlaywright } from "./auth-login.js"
import type { CliKeepaliveOptions, CliOperationOptions, CliPorts } from "./cli.js"

const millisecondsPerSecond = 1_000
const envFailure = (tag: string, message: string): OperationExecutionResult => ({
  error: { _tag: tag, message },
  ok: false
})

const runNodeOperation = async (
  name: Parameters<CliPorts["runOperation"]>[0],
  input: unknown,
  options: CliOperationOptions
): Promise<OperationExecutionResult> => {
  // the environment boundary is an environment-variable map, so the parsed
  // path travels through it as the string it already is
  const env = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: options.sessionPath })

  if (Result.isFailure(env)) {
    return envFailure(env.failure._tag, env.failure.message)
  }

  // the one promise crossing the workspace keeps: a CLI process ends in a
  // promise whatever runs inside it, and both halves of the operation's result
  // are reported the same way
  const executed = await Effect.runPromise(Effect.result(runVoilaOperation(name, input, env.success)))

  return Result.isFailure(executed) ? executed.failure : executed.success
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

const runNodeKeepalive = async (options: CliKeepaliveOptions): Promise<KeepaliveStopReason> => {
  // A missing session file is not an authentication problem — it is a
  // misconfiguration, surfaced before the loop pings Voila as a guest.
  if (!(await fileExists(options.sessionPath))) {
    process.stderr.write("voila keepalive: no session file found. Run `voila auth login` first.\n")

    return "misconfigured"
  }

  const env = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: options.sessionPath })

  if (Result.isFailure(env)) {
    process.stderr.write(`voila keepalive: ${env.failure._tag}: ${env.failure.message}\n`)

    return "misconfigured"
  }

  const config = makeKeepaliveConfig({
    stopOnExpired: true,
    ...(options.intervalSeconds === undefined
      ? {}
      : { healthyIntervalMs: options.intervalSeconds * millisecondsPerSecond })
  })

  return runKeepalive(env.success, config)
}

export const nodeCliPorts: CliPorts = {
  keepalive: runNodeKeepalive,
  login: loginWithPlaywright,
  runOperation: runNodeOperation
}
