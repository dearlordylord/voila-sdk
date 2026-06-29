import type { OperationExecutionResult } from "@firfi/voila-mcp"

interface DiscountCliParsedOptions {
  readonly flags: ReadonlySet<string>
  readonly options: ReadonlyMap<string, string>
  readonly positionals: ReadonlyArray<string>
}

interface DiscountCliRunResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

type DiscountSort = "best-percent" | "best-amount" | "price-asc"

interface DiscountsOperationInput {
  readonly minSavingsAmount?: number
  readonly minSavingsPercent?: number
  readonly pageSize?: number
  readonly pageToken?: string
  readonly query?: string
  readonly sort?: DiscountSort
}

const validDiscountSorts: ReadonlySet<string> = new Set(["best-percent", "best-amount", "price-asc"])
const maxDiscountPageSize = 24
const percentFractionDigits = 1

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isUsageResult = (value: unknown): value is DiscountCliRunResult =>
  isRecord(value)
  && typeof value.exitCode === "number"
  && typeof value.stderr === "string"
  && typeof value.stdout === "string"

const getRecord = (
  record: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, unknown>> | undefined => {
  const value = record[key]

  return isRecord(value) ? value : undefined
}

const getString = (record: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = record[key]

  return typeof value === "string" ? value : undefined
}

const getNumber = (record: Readonly<Record<string, unknown>>, key: string): number | undefined => {
  const value = record[key]

  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const parseNonNegativeNumber = (
  parsed: DiscountCliParsedOptions,
  optionName: string,
  usage: (message: string) => DiscountCliRunResult
): number | DiscountCliRunResult | undefined => {
  const key = optionName.slice(2)
  const value = parsed.options.get(key)

  if (value === undefined) {
    return parsed.flags.has(key) ? usage(`Missing ${optionName}`) : undefined
  }

  const numericValue = Number(value)

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return usage(`${optionName} must be a non-negative number`)
  }

  return numericValue
}

const parseDiscountSort = (
  value: string | undefined,
  usage: (message: string) => DiscountCliRunResult
): DiscountSort | DiscountCliRunResult | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!validDiscountSorts.has(value)) {
    return usage("--sort must be best-percent, best-amount, or price-asc")
  }

  switch (value) {
    case "best-amount":
    case "best-percent":
    case "price-asc":
      return value
  }
}

export const makeDiscountsOperationInput = (
  parsed: DiscountCliParsedOptions,
  usage: (message: string) => DiscountCliRunResult,
  parsePositiveInteger: (value: string | undefined, optionName: string) => number | DiscountCliRunResult
): DiscountsOperationInput | DiscountCliRunResult => {
  const pageSizeOption = parsed.options.get("page-size")
  const minSavingsAmount = parseNonNegativeNumber(parsed, "--min-amount", usage)
  const minSavingsPercent = parseNonNegativeNumber(parsed, "--min-percent", usage)
  const sort = parseDiscountSort(parsed.options.get("sort"), usage)

  if (isUsageResult(minSavingsAmount)) {
    return minSavingsAmount
  }

  if (isUsageResult(minSavingsPercent)) {
    return minSavingsPercent
  }

  if (isUsageResult(sort)) {
    return sort
  }

  const pageSize = pageSizeOption === undefined
    ? undefined
    : parsePositiveInteger(pageSizeOption, "--page-size")

  if (isUsageResult(pageSize)) {
    return pageSize
  }

  if (pageSize !== undefined && pageSize > maxDiscountPageSize) {
    return usage("--page-size must be at most 24")
  }

  const pageToken = parsed.options.get("page-token")

  return {
    ...(parsed.positionals[1] === undefined ? {} : { query: parsed.positionals[1] }),
    ...(minSavingsAmount === undefined ? {} : { minSavingsAmount }),
    ...(minSavingsPercent === undefined ? {} : { minSavingsPercent }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(pageToken === undefined ? {} : { pageToken }),
    ...(sort === undefined ? {} : { sort })
  }
}

const renderMoneyAmount = (product: Readonly<Record<string, unknown>>, key: string): string => {
  const money = getRecord(product, key)
  const amount = money === undefined ? undefined : getString(money, "amount")

  return amount === undefined ? "" : `$${amount}`
}

const renderProductRow = (product: Readonly<Record<string, unknown>>): string => {
  const name = getString(product, "name") ?? ""
  const saved = renderMoneyAmount(product, "savingsPrice")
  const savingsPercent = getNumber(product, "savingsPercent")
  const promo = getString(product, "promotionSummary") ?? ""

  return [
    name,
    renderMoneyAmount(product, "discountPrice"),
    renderMoneyAmount(product, "regularPrice"),
    saved,
    savingsPercent === undefined ? "" : `${savingsPercent.toFixed(percentFractionDigits)}%`,
    promo
  ].join("\t")
}

export const renderDiscountsText = (result: OperationExecutionResult): string => {
  if (!result.ok || !isRecord(result.value)) {
    return ""
  }

  const products = result.value.products

  if (!Array.isArray(products)) {
    return `${JSON.stringify(result.value, undefined, 2)}\n`
  }

  const rows = products.flatMap((product) => isRecord(product) ? [renderProductRow(product)] : [])

  return [
    "Product\tNow\tWas\tSaved\tSave %\tPromo",
    ...rows
  ].join("\n") + "\n"
}
