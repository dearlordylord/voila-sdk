import { Match, Result, Schema } from "effect"

import {
  AuthCommandSchema,
  browserProfilePath,
  CartCommandSchema,
  commandMessage,
  decodeCommand,
  decodeHelp,
  OrderCommandSchema,
  optionField,
  RootCommandSchema,
  routeValidation,
  sessionField,
  withHelp,
  type CliCommand
} from "./cli-command-schema.js"
import { getOptionValue, hasFlag, usage, type CliParsedOptions, type CliRunResult } from "./cli-model.js"

const commandWithIdentifierPositionals = 3

const parseAuthLogin = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(parsed, "auth login", ["json", "help"], ["session", "profile", "timeout-ms"], 2, 2)

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "auth-login",
          json: hasFlag(parsed, "json"),
          profilePath: browserProfilePath(parsed),
          ...sessionField("auth-login", parsed),
          ...optionField("auth-login", "timeoutMs", getOptionValue(parsed, "timeout-ms"))
        },
        commandMessage(
          parsed,
          [["timeout-ms", "--timeout-ms must be a positive safe integer"]],
          "Invalid auth login options"
        )
      )
    )
  )
}

const parseAuthStatus = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(parsed, "auth status", ["json", "help"], ["session"], 2, 2)

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        { _tag: "auth-status", json: hasFlag(parsed, "json"), ...sessionField("auth-status", parsed) },
        "Invalid auth status options"
      )
    )
  )
}

const parseAuthKeepalive = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(parsed, "auth keepalive", ["help"], ["session", "interval"], 2, 2)

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "auth-keepalive",
          ...optionField("auth-keepalive", "intervalSeconds", getOptionValue(parsed, "interval")),
          ...sessionField("auth-keepalive", parsed)
        },
        commandMessage(
          parsed,
          [["interval", "--interval must be a whole number of at least 3600 seconds"]],
          "Invalid auth keepalive options"
        )
      )
    )
  )
}

const parseAuth = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const command = Schema.decodeUnknownResult(AuthCommandSchema)(parsed.positionals[1])

  return Result.isFailure(command)
    ? usage("Expected auth login, auth status, or auth keepalive")
    : Match.value(command.success).pipe(
        Match.when("login", () => parseAuthLogin(parsed)),
        Match.when("status", () => parseAuthStatus(parsed)),
        Match.when("keepalive", () => parseAuthKeepalive(parsed)),
        Match.exhaustive
      )
}

const parseSearch = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(parsed, "search", ["json", "help"], ["session", "page-size", "page-token"], 2, 2)

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "search",
          json: hasFlag(parsed, "json"),
          ...optionField("search", "pageSize", getOptionValue(parsed, "page-size")),
          ...optionField("search", "pageToken", getOptionValue(parsed, "page-token")),
          query: parsed.positionals[1],
          ...sessionField("search", parsed)
        },
        commandMessage(parsed, [["page-size", "--page-size must be between 1 and 24"]], "Invalid search options")
      )
    )
  )
}

const parseDiscounts = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(
    parsed,
    "discounts",
    ["json", "help"],
    ["session", "page-size", "page-token", "min-percent", "min-amount", "sort"],
    1,
    2
  )

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "discounts",
          json: hasFlag(parsed, "json"),
          ...optionField("discounts", "minSavingsAmount", getOptionValue(parsed, "min-amount")),
          ...optionField("discounts", "minSavingsPercent", getOptionValue(parsed, "min-percent")),
          ...optionField("discounts", "pageSize", getOptionValue(parsed, "page-size")),
          ...optionField("discounts", "pageToken", getOptionValue(parsed, "page-token")),
          ...(parsed.positionals[1] === undefined ? {} : { query: parsed.positionals[1] }),
          ...sessionField("discounts", parsed),
          ...optionField("discounts", "sort", getOptionValue(parsed, "sort"))
        },
        commandMessage(
          parsed,
          [
            ["page-size", "--page-size must be between 1 and 24"],
            ["min-amount", "--min-amount must be a non-negative safe number"],
            ["min-percent", "--min-percent must be a non-negative safe number"]
          ],
          "Invalid discounts options"
        )
      )
    )
  )
}

const parseCategory = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const command = Schema.decodeUnknownResult(Schema.Literal("products"))(parsed.positionals[1])
  const routeError = routeValidation(
    parsed,
    "category products",
    ["json", "help"],
    ["session", "page-size", "page-token"],
    commandWithIdentifierPositionals,
    commandWithIdentifierPositionals
  )

  return Result.isFailure(command)
    ? usage("Expected category products")
    : (routeError ??
        withHelp(
          parsed,
          decodeCommand(
            {
              _tag: "category-products",
              categoryId: parsed.positionals[2],
              json: hasFlag(parsed, "json"),
              ...optionField("category-products", "pageSize", getOptionValue(parsed, "page-size")),
              ...optionField("category-products", "pageToken", getOptionValue(parsed, "page-token")),
              ...sessionField("category-products", parsed)
            },
            commandMessage(parsed, [["page-size", "--page-size must be between 1 and 24"]], "Invalid category options")
          )
        ))
}

const parseOrdersList = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(
    parsed,
    "orders list",
    ["json", "help"],
    ["session", "page-size", "page-token"],
    2,
    2
  )

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "orders-list",
          json: hasFlag(parsed, "json"),
          ...optionField("orders-list", "pageSize", getOptionValue(parsed, "page-size")),
          ...optionField("orders-list", "pageToken", getOptionValue(parsed, "page-token")),
          ...sessionField("orders-list", parsed)
        },
        commandMessage(parsed, [["page-size", "--page-size must be between 1 and 50"]], "Invalid orders list options")
      )
    )
  )
}

const parseOrdersDetails = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(
    parsed,
    "orders details",
    ["json", "help"],
    ["session"],
    commandWithIdentifierPositionals,
    commandWithIdentifierPositionals
  )

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "orders-details",
          json: hasFlag(parsed, "json"),
          orderId: parsed.positionals[2],
          ...sessionField("orders-details", parsed)
        },
        "Invalid orders details options"
      )
    )
  )
}

const parseOrdersItems = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(
    parsed,
    "orders items",
    ["json", "help"],
    ["session", "page-size", "page-token", "from-date", "to-date", "max-orders"],
    2,
    2
  )

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: "orders-items",
          ...optionField("orders-items", "fromDate", getOptionValue(parsed, "from-date")),
          json: hasFlag(parsed, "json"),
          ...optionField("orders-items", "maxOrders", getOptionValue(parsed, "max-orders")),
          ...optionField("orders-items", "pageSize", getOptionValue(parsed, "page-size")),
          ...optionField("orders-items", "pageToken", getOptionValue(parsed, "page-token")),
          ...sessionField("orders-items", parsed),
          ...optionField("orders-items", "toDate", getOptionValue(parsed, "to-date"))
        },
        commandMessage(
          parsed,
          [
            ["page-size", "--page-size must be between 1 and 50"],
            ["max-orders", "--max-orders must be between 1 and 50"]
          ],
          "Invalid orders items options"
        )
      )
    )
  )
}

const parseOrders = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const command = Schema.decodeUnknownResult(OrderCommandSchema)(parsed.positionals[1])

  return Result.isFailure(command)
    ? usage("Expected orders list, orders details, or orders items")
    : Match.value(command.success).pipe(
        Match.when("list", () => parseOrdersList(parsed)),
        Match.when("details", () => parseOrdersDetails(parsed)),
        Match.when("items", () => parseOrdersItems(parsed)),
        Match.exhaustive
      )
}

const parseCartGet = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const routeError = routeValidation(parsed, "cart get", ["json", "help"], ["session"], 2, 2)

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        { _tag: "cart-get", json: hasFlag(parsed, "json"), ...sessionField("cart-get", parsed) },
        "Invalid cart get options"
      )
    )
  )
}

const parseCartMutation = (parsed: CliParsedOptions, tag: "cart-add" | "cart-remove"): CliCommand | CliRunResult => {
  const route = Match.value(tag).pipe(
    Match.when("cart-add", () => "cart add"),
    Match.when("cart-remove", () => "cart remove"),
    Match.exhaustive
  )
  const routeError = routeValidation(
    parsed,
    route,
    ["json", "help"],
    ["session", "quantity"],
    commandWithIdentifierPositionals,
    commandWithIdentifierPositionals
  )

  return (
    routeError ??
    withHelp(
      parsed,
      decodeCommand(
        {
          _tag: tag,
          json: hasFlag(parsed, "json"),
          productId: parsed.positionals[2],
          ...optionField(tag, "quantity", getOptionValue(parsed, "quantity")),
          ...sessionField(tag, parsed)
        },
        commandMessage(parsed, [["quantity", "--quantity must be a positive safe integer"]], `Invalid ${route} options`)
      )
    )
  )
}

const parseCart = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const command = Schema.decodeUnknownResult(CartCommandSchema)(parsed.positionals[1])

  return Result.isFailure(command)
    ? usage("Expected cart get, cart add, or cart remove")
    : Match.value(command.success).pipe(
        Match.when("get", () => parseCartGet(parsed)),
        Match.when("add", () => parseCartMutation(parsed, "cart-add")),
        Match.when("remove", () => parseCartMutation(parsed, "cart-remove")),
        Match.exhaustive
      )
}

const parseRoot = (parsed: CliParsedOptions): CliCommand | CliRunResult => {
  const root = Schema.decodeUnknownResult(RootCommandSchema)(parsed.positionals[0])

  return Result.isFailure(root)
    ? usage("Unknown command")
    : Match.value(root.success).pipe(
        Match.when("auth", () => parseAuth(parsed)),
        Match.when("cart", () => parseCart(parsed)),
        Match.when("category", () => parseCategory(parsed)),
        Match.when("discounts", () => parseDiscounts(parsed)),
        Match.when("orders", () => parseOrders(parsed)),
        Match.when("search", () => parseSearch(parsed)),
        Match.exhaustive
      )
}

export const parseCliCommand = (parsed: CliParsedOptions): CliCommand | CliRunResult =>
  hasFlag(parsed, "help") ? decodeHelp() : parsed.positionals.length === 0 ? decodeHelp() : parseRoot(parsed)

export type {
  AuthKeepaliveCommand,
  AuthLoginCommand,
  AuthStatusCommand,
  CartAddCommand,
  CartGetCommand,
  CartRemoveCommand,
  CategoryProductsCommand,
  CliCommand,
  DiscountsCommand,
  OrdersDetailsCommand,
  OrdersItemsCommand,
  OrdersListCommand,
  SearchCommand
} from "./cli-command-schema.js"
