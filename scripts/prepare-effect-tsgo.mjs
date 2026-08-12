import { execFileSync } from "node:child_process"
import { chmodSync } from "node:fs"
import { resolve } from "node:path"

if (process.platform !== "win32") {
  const cliPath = resolve("node_modules", ".bin", "effect-tsgo")
  const executablePath = execFileSync(cliPath, ["get-exe-path"], { encoding: "utf8" }).trim()

  // @effect/tsgo 0.24.3 publishes its native binaries without an executable bit.
  chmodSync(executablePath, 0o755)
}
