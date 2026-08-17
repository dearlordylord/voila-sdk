import { makeNodeOperationEnvironment, type OperationExecutionResult, runVoilaOperation } from "@firfi/voila-mcp"
import { Either } from "effect"
import { resolve } from "node:path"

import { loginWithPlaywright } from "./auth-login.js"
import type { CliLoginOptions, CliOperationOptions, CliPorts } from "./cli.js"

const envFailure = (tag: string, message: string): OperationExecutionResult => ({
  error: { _tag: tag, message },
  ok: false
})

// A session file is named by one absolute path everywhere below this line: the
// working directory a command happened to run in is resolved here, at the edge
// where the argument arrives, and never travels further as a relative path.
const absoluteSessionPath: (sessionPath: string) => string = resolve

const runNodeOperation = async (
  name: Parameters<CliPorts["runOperation"]>[0],
  input: unknown,
  options: CliOperationOptions
): Promise<OperationExecutionResult> => {
  const env = makeNodeOperationEnvironment({ VOILA_AUTH_SESSION_PATH: absoluteSessionPath(options.sessionPath) })

  if (Either.isLeft(env)) {
    return envFailure(env.left._tag, env.left.message)
  }

  return runVoilaOperation(name, input, env.right)
}

const runNodeLogin = (options: CliLoginOptions): Promise<OperationExecutionResult> =>
  loginWithPlaywright({ ...options, sessionPath: absoluteSessionPath(options.sessionPath) })

export const nodeCliPorts: CliPorts = { login: runNodeLogin, runOperation: runNodeOperation }
