import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"
import { runBoundedCommand } from "./run-bounded-command.mjs"

const second = 1_000
const maximumSuccessfulOutputLines = 300
const pnpmEntryPoint = process.env.npm_execpath

if (pnpmEntryPoint === undefined) {
  throw new Error("Run the quality gate through pnpm so its executable can be resolved safely")
}

const gates = [
  { args: ["rebuild:native"], name: "native dependencies", timeout: 5 * 60 * second },
  { args: ["build"], name: "build", timeout: 2 * 60 * second },
  { args: ["check:package-boundary"], name: "package boundaries", timeout: 60 * second },
  { args: ["typecheck"], name: "TypeScript and Effect diagnostics", timeout: 3 * 60 * second },
  { args: ["circular"], name: "dependency cycles", timeout: 60 * second },
  { args: ["check:complexity"], name: "cyclomatic complexity", timeout: 60 * second },
  { args: ["verify-registry-metadata"], name: "registry metadata", timeout: 60 * second },
  { args: ["lint"], name: "lint, format, and duplication", timeout: 2 * 60 * second },
  { args: ["fixtures:audit"], name: "fixture safety", timeout: 60 * second },
  { args: ["test:harness"], name: "quality harness tests", timeout: 60 * second },
  { args: ["test:coverage"], name: "tests and coverage", timeout: 5 * 60 * second }
]

let successfulOutputLines = 0

for (const gate of gates) {
  const result = await runBoundedCommand({
    args: [pnpmEntryPoint, ...gate.args],
    executable: process.execPath,
    name: `Quality gate '${gate.name}'`,
    timeoutMilliseconds: gate.timeout
  })

  successfulOutputLines = addSuccessfulOutputLines({
    currentOutputLines: successfulOutputLines,
    maximumOutputLines: maximumSuccessfulOutputLines,
    stageName: gate.name,
    stageOutputLines: result.outputLineCount
  })
}

console.log(`Quality gate emitted ${successfulOutputLines}/${maximumSuccessfulOutputLines} successful output lines.`)
