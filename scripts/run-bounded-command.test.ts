import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { runBoundedCommand } from "./run-bounded-command.mjs"

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

test("counts complete and unterminated stdout and stderr lines", async () => {
  const result = await runBoundedCommand({
    args: ["-e", "process.stdout.write('first\\nsecond'); process.stderr.write('third\\n')"],
    executable: process.execPath,
    forwardOutput: false,
    name: "output line fixture",
    timeoutMilliseconds: 2_000
  })

  expect(result).toEqual({ outputLineCount: 3 })
})

test("rejects a failed command", async () => {
  await expect(
    runBoundedCommand({
      args: ["-e", "process.exit(7)"],
      executable: process.execPath,
      forwardOutput: false,
      name: "failure fixture",
      timeoutMilliseconds: 2_000
    })
  ).rejects.toThrow("failure fixture failed with exit 7")
})

test.skipIf(process.platform === "win32")("kills a resistant descendant after timing out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voila-bounded-command-"))
  const pidFile = join(directory, "descendant.pid")
  const resistantDescendant = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
  const leader = `
    const { spawn } = require("node:child_process")
    const { writeFileSync } = require("node:fs")
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(resistantDescendant)}], { stdio: "ignore" })
    writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid))
    process.on("SIGTERM", () => process.exit(0))
    setInterval(() => {}, 1000)
  `

  try {
    await expect(
      runBoundedCommand({
        args: ["-e", leader],
        executable: process.execPath,
        forwardOutput: false,
        name: "resistant descendant fixture",
        terminationGraceMilliseconds: 100,
        timeoutMilliseconds: 500
      })
    ).rejects.toThrow("resistant descendant fixture exceeded 0.5 seconds")

    const descendantPid = Number(await readFile(pidFile, "utf8"))
    await expect.poll(() => processExists(descendantPid), { interval: 20, timeout: 2_000 }).toBe(false)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
