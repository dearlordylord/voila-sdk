import { spawn, spawnSync } from "node:child_process"
import { clearTimeout, setTimeout } from "node:timers"

const defaultTerminationGraceMilliseconds = 5_000

const terminate = (child, signal) => {
  if (child.pid === undefined) return

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

export const runBoundedCommand = ({
  args,
  executable,
  forwardOutput = true,
  name,
  terminationGraceMilliseconds = defaultTerminationGraceMilliseconds,
  timeoutMilliseconds
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: process.platform !== "win32",
      stdio: ["inherit", "pipe", "pipe"]
    })
    const stdoutLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    const stderrLineCounter = { endsWithLineBreak: true, lineBreaks: 0, wasWritten: false }
    let timedOut = false
    let escalationTimer

    const observeOutput = (output, destination, lineCounter) => {
      lineCounter.wasWritten = true
      lineCounter.endsWithLineBreak = output.at(-1) === 10

      for (const byte of output) {
        if (byte === 10) lineCounter.lineBreaks += 1
      }

      if (forwardOutput) destination.write(output)
    }

    child.stdout.on("data", (output) => {
      observeOutput(output, process.stdout, stdoutLineCounter)
    })
    child.stderr.on("data", (output) => {
      observeOutput(output, process.stderr, stderrLineCounter)
    })

    const timer = setTimeout(() => {
      timedOut = true
      try {
        terminate(child, "SIGTERM")
      } catch (error) {
        reject(error)
        return
      }

      if (process.platform === "win32") {
        reject(new Error(`${name} exceeded ${timeoutMilliseconds / 1_000} seconds`))
        return
      }

      escalationTimer = setTimeout(() => {
        try {
          terminate(child, "SIGKILL")
          reject(new Error(`${name} exceeded ${timeoutMilliseconds / 1_000} seconds`))
        } catch (error) {
          reject(error)
        }
      }, terminationGraceMilliseconds)
    }, timeoutMilliseconds)

    child.once("error", (error) => {
      clearTimeout(timer)

      if (!timedOut) {
        clearTimeout(escalationTimer)
        reject(error)
      }
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (timedOut) return

      clearTimeout(escalationTimer)

      if (code !== 0) {
        reject(new Error(`${name} failed with ${signal ?? `exit ${code}`}`))
        return
      }

      const outputLineCount = [stdoutLineCounter, stderrLineCounter].reduce(
        (total, lineCounter) =>
          total + lineCounter.lineBreaks + (lineCounter.wasWritten && !lineCounter.endsWithLineBreak ? 1 : 0),
        0
      )

      resolve({ outputLineCount })
    })
  })
