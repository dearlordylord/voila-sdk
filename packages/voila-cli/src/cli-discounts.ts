import type { DiscountedProductsOperationInput, OperationExecutionResult } from "@firfi/voila-mcp"

import type { DiscountsCommand } from "./cli-commands.js"

export const makeDiscountsOperationInput = (command: DiscountsCommand): DiscountedProductsOperationInput => ({
  ...(command.minSavingsAmount === undefined ? {} : { minSavingsAmount: command.minSavingsAmount }),
  ...(command.minSavingsPercent === undefined ? {} : { minSavingsPercent: command.minSavingsPercent }),
  ...(command.pageSize === undefined ? {} : { pageSize: command.pageSize }),
  ...(command.pageToken === undefined ? {} : { pageToken: command.pageToken }),
  ...(command.query === undefined ? {} : { query: command.query }),
  ...(command.sort === undefined ? {} : { sort: command.sort })
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

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

const percentFractionDigits = 1

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

  const rows = products.flatMap((product) => (isRecord(product) ? [renderProductRow(product)] : []))

  return ["Product\tNow\tWas\tSaved\tSave %\tPromo", ...rows].join("\n") + "\n"
}
