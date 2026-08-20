import { type BrowserLoginTimeoutMs, type KeepaliveIntervalSeconds, type KeepaliveStopReason } from "@firfi/voila-sdk"
import type { OperationExecutionResult, VoilaOperationName } from "@firfi/voila-mcp"
import type { StateFilePath } from "@firfi/voila-session-store"
import { Match, Result, Schema } from "effect"

import { helpText as commandHelpText } from "./help.js"

const successExitCode = 0
const failureExitCode = 1
const usageExitCode = 2

/** A CLI result owns its output channel and exit semantics as one value. */
export const CliRunResultSchema = Schema.TaggedUnion({
  success: { exitCode: Schema.Literal(successExitCode), stdout: Schema.String },
  "json-failure": { exitCode: Schema.Literal(failureExitCode), stdout: Schema.String },
  "text-failure": { exitCode: Schema.Literal(failureExitCode), stderr: Schema.String },
  usage: { exitCode: Schema.Literal(usageExitCode), stderr: Schema.String }
})

export type CliRunResult = Schema.Schema.Type<typeof CliRunResultSchema>

export type CliFlag = "json" | "help"

export type CliValueOptionName =
  | "from-date"
  | "interval"
  | "max-orders"
  | "min-amount"
  | "min-percent"
  | "page-size"
  | "page-token"
  | "profile"
  | "quantity"
  | "session"
  | "sort"
  | "timeout-ms"
  | "to-date"

export interface CliOperationOptions {
  readonly sessionPath: StateFilePath
}

export type CliStderrWriter = (message: string) => void
export const BrowserPollDelayMsSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
).pipe(Schema.brand("BrowserPollDelayMs"))

export type BrowserPollDelayMs = Schema.Schema.Type<typeof BrowserPollDelayMsSchema>
export type CliDelay = (milliseconds: BrowserPollDelayMs) => Promise<void>

export interface CliProgressPort {
  readonly write: CliStderrWriter
}

export type CliLoginOptions = {
  readonly profilePath: string
  readonly sessionPath: StateFilePath
  readonly timeoutMs?: BrowserLoginTimeoutMs
} & { readonly delay: CliDelay; readonly progress: CliProgressPort }

export interface CliKeepaliveOptions {
  readonly intervalSeconds?: KeepaliveIntervalSeconds
  readonly sessionPath: StateFilePath
}

export interface CliPorts {
  readonly delay: CliDelay
  readonly keepalive: (options: CliKeepaliveOptions) => Promise<KeepaliveStopReason>
  readonly writeStderr: CliStderrWriter
  readonly login: (options: CliLoginOptions) => Promise<OperationExecutionResult>
  readonly runOperation: (
    name: VoilaOperationName,
    input: unknown,
    options: CliOperationOptions
  ) => Promise<OperationExecutionResult>
}

export interface CliParsedOptions {
  readonly flags: ReadonlyArray<CliFlag>
  readonly options: ReadonlyArray<readonly [CliValueOptionName, string]>
  readonly positionals: ReadonlyArray<string>
}

export const helpText = commandHelpText

export const isCliRunResult = (value: unknown): value is CliRunResult => Schema.is(CliRunResultSchema)(value)

export const usage = (message: string): CliRunResult => ({
  _tag: "usage",
  exitCode: usageExitCode,
  stderr: `${message}\n\n${helpText}\n`
})

export const ok = (stdout: string): CliRunResult => ({ _tag: "success", exitCode: successExitCode, stdout })

const renderFailureText = (result: OperationExecutionResult): string => {
  if (result.ok) {
    return ""
  }

  const guidance = result.error.authGuidance
  const base = `${result.error._tag}: ${result.error.message}\n`

  if (guidance === undefined) {
    return base
  }

  return [base, `${guidance.message}\n`, `${guidance.instructions}\n`, `Login command: ${guidance.command}\n`].join("")
}

export const fail = (result: OperationExecutionResult, json: boolean): CliRunResult =>
  json
    ? { _tag: "json-failure", exitCode: failureExitCode, stdout: `${JSON.stringify(result, undefined, 2)}\n` }
    : { _tag: "text-failure", exitCode: failureExitCode, stderr: renderFailureText(result) }

const textFailure = (stderr: string): CliRunResult => ({ _tag: "text-failure", exitCode: failureExitCode, stderr })

const usageFailure = (stderr: string): CliRunResult => ({ _tag: "usage", exitCode: usageExitCode, stderr })

interface CliArgAccumulator {
  readonly flags: ReadonlyArray<CliFlag>
  readonly options: ReadonlyArray<readonly [CliValueOptionName, string]>
  readonly positionals: ReadonlyArray<string>
}

interface CliArgParseStep {
  readonly accumulator: CliArgAccumulator
  readonly nextIndex: number
}

const cliFlagsSchema = Schema.Literals(["json", "help"])
const cliOptionsSchema = Schema.Literals([
  "from-date",
  "interval",
  "max-orders",
  "min-amount",
  "min-percent",
  "page-size",
  "page-token",
  "profile",
  "quantity",
  "session",
  "sort",
  "timeout-ms",
  "to-date"
])

const optionEntry = (name: CliValueOptionName, value: string): readonly [CliValueOptionName, string] => [name, value]

const optionValue = (parsed: CliParsedOptions, name: CliValueOptionName): string | undefined =>
  parsed.options.find(([candidate]) => candidate === name)?.[1]

export const getOptionValue = optionValue

export const hasFlag = (parsed: CliParsedOptions, flag: CliFlag): boolean => parsed.flags.includes(flag)

const parseOption = (
  args: ReadonlyArray<string>,
  index: number,
  name: string,
  accumulator: CliArgAccumulator
): CliArgParseStep | CliRunResult => {
  const flag = Schema.decodeUnknownResult(cliFlagsSchema)(name)

  if (Result.isSuccess(flag)) {
    return accumulator.flags.includes(flag.success)
      ? usage(`Duplicate --${name}`)
      : {
          accumulator: {
            flags: [...accumulator.flags, flag.success],
            options: accumulator.options,
            positionals: accumulator.positionals
          },
          nextIndex: index
        }
  }

  const optionName = Schema.decodeUnknownResult(cliOptionsSchema)(name)

  if (Result.isFailure(optionName)) {
    return usage(`Unknown option --${name}`)
  }

  const value = args[index + 1]

  if (value === undefined || value.startsWith("--")) {
    return usage(`Missing --${name}`)
  }

  return accumulator.options.some(([candidate]) => candidate === optionName.success)
    ? usage(`Duplicate --${name}`)
    : {
        accumulator: {
          flags: accumulator.flags,
          options: [...accumulator.options, optionEntry(optionName.success, value)],
          positionals: accumulator.positionals
        },
        nextIndex: index + 1
      }
}

const parseArgsAt = (
  args: ReadonlyArray<string>,
  index: number,
  accumulator: CliArgAccumulator
): CliParsedOptions | CliRunResult => {
  const arg = args[index]

  if (arg === undefined) {
    return accumulator
  }

  if (!arg.startsWith("--")) {
    return parseArgsAt(args, index + 1, {
      flags: accumulator.flags,
      options: accumulator.options,
      positionals: [...accumulator.positionals, arg]
    })
  }

  const parsed = parseOption(args, index, arg.slice(2), accumulator)

  return isCliRunResult(parsed) ? parsed : parseArgsAt(args, parsed.nextIndex + 1, parsed.accumulator)
}

export const parseArgs = (args: ReadonlyArray<string>): CliParsedOptions | CliRunResult =>
  parseArgsAt(args, 0, { flags: [], options: [], positionals: [] })

export const renderKeepalive = (reason: KeepaliveStopReason): CliRunResult =>
  Match.value(reason).pipe(
    Match.when("expired", () => textFailure("Session requires re-authentication. Run: voila auth login\n")),
    Match.when("misconfigured", () =>
      usageFailure("No authenticated session snapshot is configured. Run: voila auth login\n")
    ),
    Match.when("cancelled", () => ok("Keepalive stopped.\n")),
    Match.exhaustive
  )
