import { normalizeCliCartInput, type OperationExecutionResult, type VoilaOperationName } from "@firfi/voila-mcp"

import { defaultBrowserProfilePath, defaultSessionPath } from "./defaults.js"

export interface CliOperationOptions {
  readonly sessionPath: string
}

export interface CliLoginOptions {
  readonly profilePath: string
  readonly sessionPath: string
  readonly timeoutMs?: number
}

export interface CliPorts {
  readonly login: (options: CliLoginOptions) => Promise<OperationExecutionResult>
  readonly runOperation: (
    name: VoilaOperationName,
    input: unknown,
    options: CliOperationOptions
  ) => Promise<OperationExecutionResult>
}

export interface CliRunResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

interface ParsedOptions {
  readonly flags: ReadonlySet<string>
  readonly options: ReadonlyMap<string, string>
  readonly positionals: ReadonlyArray<string>
}

const successExitCode = 0
const failureExitCode = 1
const usageExitCode = 2

const helpText = `Usage:
  voila auth login --session <path> [--profile <dir>] [--timeout-ms <ms>]
  voila auth status [--session <path>] [--json]
  voila search <query> [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila category products <category-id> [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila orders list [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila cart get [--session <path>] [--json]
  voila cart add <product-id> --quantity <n> [--session <path>] [--json]
  voila cart remove <product-id> --quantity <n> [--session <path>] [--json]`

const parseArgs = (args: ReadonlyArray<string>): ParsedOptions => {
  const flags = new Set<string>()
  const options = new Map<string, string>()
  const positionals: Array<string> = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === undefined) {
      continue
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const name = arg.slice(2)

    if (name === "json" || name === "help") {
      flags.add(name)
      continue
    }

    const value = args[index + 1]

    if (value === undefined || value.startsWith("--")) {
      flags.add(name)
      continue
    }

    options.set(name, value)
    index += 1
  }

  return {
    flags,
    options,
    positionals
  }
}

const usage = (message: string): CliRunResult => ({
  exitCode: usageExitCode,
  stderr: `${message}\n\n${helpText}\n`,
  stdout: ""
})

const ok = (stdout: string): CliRunResult => ({
  exitCode: successExitCode,
  stderr: "",
  stdout
})

const fail = (result: OperationExecutionResult): CliRunResult => ({
  exitCode: failureExitCode,
  stderr: result.ok ? "" : `${result.error._tag}: ${result.error.message}\n`,
  stdout: ""
})

const getSessionPath = (parsed: ParsedOptions): string => parsed.options.get("session") ?? defaultSessionPath()

const getJsonFlag = (parsed: ParsedOptions): boolean => parsed.flags.has("json")

const parsePositiveInteger = (value: string | undefined, optionName: string): number | CliRunResult => {
  if (value === undefined) {
    return usage(`Missing ${optionName}`)
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return usage(`${optionName} must be a positive integer`)
  }

  return parsed
}

const optionalPageInput = (parsed: ParsedOptions) => {
  const pageSizeOption = parsed.options.get("page-size")

  if (pageSizeOption === undefined) {
    return {
      ...(parsed.options.get("page-token") === undefined ? {} : { pageToken: parsed.options.get("page-token") })
    }
  }

  const pageSize = parsePositiveInteger(pageSizeOption, "--page-size")

  if (typeof pageSize !== "number") {
    return pageSize
  }

  return {
    pageSize,
    ...(parsed.options.get("page-token") === undefined ? {} : { pageToken: parsed.options.get("page-token") })
  }
}

const renderText = (name: VoilaOperationName | "auth_login", result: OperationExecutionResult): string => {
  if (!result.ok) {
    return ""
  }

  if (name === "auth_login") {
    return "Authenticated session saved.\n"
  }

  return `${JSON.stringify(result.value, undefined, 2)}\n`
}

const render = (
  name: VoilaOperationName | "auth_login",
  result: OperationExecutionResult,
  json: boolean
): CliRunResult => {
  if (!result.ok) {
    return fail(result)
  }

  if (json) {
    return ok(`${JSON.stringify(result, undefined, 2)}\n`)
  }

  return ok(renderText(name, result))
}

const runOperation = async (
  ports: CliPorts,
  name: VoilaOperationName,
  input: unknown,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  const result = await ports.runOperation(name, input, {
    sessionPath: getSessionPath(parsed)
  })

  return render(name, result, getJsonFlag(parsed))
}

const runAuth = async (
  ports: CliPorts,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  const subcommand = parsed.positionals[1]

  if (subcommand === "status") {
    return runOperation(ports, "voila_check_session_health", {}, parsed)
  }

  if (subcommand !== "login") {
    return usage("Expected auth login or auth status")
  }

  const timeout = parsed.options.get("timeout-ms") === undefined
    ? undefined
    : parsePositiveInteger(parsed.options.get("timeout-ms"), "--timeout-ms")

  if (timeout !== undefined && typeof timeout !== "number") {
    return timeout
  }

  const result = await ports.login({
    profilePath: parsed.options.get("profile") ?? defaultBrowserProfilePath(),
    sessionPath: getSessionPath(parsed),
    ...(timeout === undefined ? {} : { timeoutMs: timeout })
  })

  return render("auth_login", result, getJsonFlag(parsed))
}

const runSearch = async (
  ports: CliPorts,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  const query = parsed.positionals[1]

  if (query === undefined) {
    return usage("Missing search query")
  }

  const page = optionalPageInput(parsed)

  if ("exitCode" in page) {
    return page
  }

  return runOperation(ports, "voila_search_products", {
    ...page,
    query
  }, parsed)
}

const runCategory = async (
  ports: CliPorts,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  if (parsed.positionals[1] !== "products") {
    return usage("Expected category products")
  }

  const categoryId = parsed.positionals[2]

  if (categoryId === undefined) {
    return usage("Missing category id")
  }

  const page = optionalPageInput(parsed)

  if ("exitCode" in page) {
    return page
  }

  return runOperation(ports, "voila_get_category_products", {
    ...page,
    categoryId
  }, parsed)
}

const runOrders = async (
  ports: CliPorts,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  if (parsed.positionals[1] !== "list") {
    return usage("Expected orders list")
  }

  const page = optionalPageInput(parsed)

  if ("exitCode" in page) {
    return page
  }

  return runOperation(ports, "voila_get_completed_orders", page, parsed)
}

const runCart = async (
  ports: CliPorts,
  parsed: ParsedOptions
): Promise<CliRunResult> => {
  const subcommand = parsed.positionals[1]

  if (subcommand === "get") {
    return runOperation(ports, "voila_get_cart", {}, parsed)
  }

  if (subcommand !== "add" && subcommand !== "remove") {
    return usage("Expected cart get, cart add, or cart remove")
  }

  const productId = parsed.positionals[2]

  if (productId === undefined) {
    return usage("Missing product id")
  }

  const quantity = parsePositiveInteger(parsed.options.get("quantity"), "--quantity")

  if (typeof quantity !== "number") {
    return quantity
  }

  return runOperation(
    ports,
    subcommand === "add" ? "voila_add_cart_items" : "voila_remove_cart_items",
    normalizeCliCartInput(productId, quantity),
    parsed
  )
}

export const runCli = async (
  args: ReadonlyArray<string>,
  ports: CliPorts
): Promise<CliRunResult> => {
  const parsed = parseArgs(args)

  if (parsed.flags.has("help") || parsed.positionals.length === 0) {
    return ok(`${helpText}\n`)
  }

  switch (parsed.positionals[0]) {
    case "auth":
      return runAuth(ports, parsed)
    case "cart":
      return runCart(ports, parsed)
    case "category":
      return runCategory(ports, parsed)
    case "orders":
      return runOrders(ports, parsed)
    case "search":
      return runSearch(ports, parsed)
    default:
      return usage("Unknown command")
  }
}
