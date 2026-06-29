import { runCli } from "./cli.js"
import { nodeCliPorts } from "./ports.js"

const main = async (): Promise<void> => {
  const result = await runCli(process.argv.slice(2), nodeCliPorts)

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Voila CLI failed\n")
  process.exitCode = 1
})
