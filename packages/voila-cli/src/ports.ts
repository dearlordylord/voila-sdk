import { makeNodeOperationEnvironment, type OperationExecutionResult, runVoilaOperation } from "@firfi/voila-mcp"
import { Effect, Result } from "effect"

import { loginWithPlaywright } from "./auth-login.js"
import type { CliOperationOptions, CliPorts } from "./cli.js"

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

export const nodeCliPorts: CliPorts = { login: loginWithPlaywright, runOperation: runNodeOperation }
