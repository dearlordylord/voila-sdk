import { runCli } from "./cli.js"
import type { CliRunResult } from "./cli-model.js"
import { nodeCliPorts } from "./ports.js"
import { Match } from "effect"

const writeCliResult = Match.typeTags<CliRunResult>()({
  success: ({ stdout }) => process.stdout.write(stdout),
  "json-failure": ({ stdout }) => process.stdout.write(stdout),
  "text-failure": ({ stderr }) => process.stderr.write(stderr),
  usage: ({ stderr }) => process.stderr.write(stderr)
})

const main = async (): Promise<void> => {
  const result = await runCli(process.argv.slice(2), nodeCliPorts)

  writeCliResult(result)
  process.exitCode = result.exitCode
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Voila CLI failed\n")
  process.exitCode = 1
})
