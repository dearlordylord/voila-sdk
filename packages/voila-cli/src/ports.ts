import { makeNodeOperationEnvironment, type OperationExecutionResult, runVoilaOperation } from "@firfi/voila-mcp"
import { Either } from "effect"

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

  if (Either.isLeft(env)) {
    return envFailure(env.left._tag, env.left.message)
  }

  return runVoilaOperation(name, input, env.right)
}

export const nodeCliPorts: CliPorts = { login: loginWithPlaywright, runOperation: runNodeOperation }
