import { Either } from "effect"

import { startStdioServer } from "./mcp-server.js"
import { makeNodeOperationEnvironment } from "./node-env.js"

const main = async (): Promise<void> => {
  const env = makeNodeOperationEnvironment()

  if (Either.isLeft(env)) {
    process.stderr.write(`${env.left._tag}: ${env.left.message}\n`)
    process.exitCode = 1

    return
  }

  await startStdioServer(env.right)
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Voila MCP failed to start\n")
  process.exitCode = 1
})
