import { normalizeCliCartInput, type OperationExecutionResult, type VoilaOperationName } from "@firfi/voila-mcp"
import { Match } from "effect"

import { makeDiscountsOperationInput, renderDiscountsText } from "./cli-discounts.js"
import {
  parseCliCommand,
  type AuthKeepaliveCommand,
  type AuthLoginCommand,
  type AuthStatusCommand,
  type CartAddCommand,
  type CartGetCommand,
  type CartRemoveCommand,
  type CategoryProductsCommand,
  type CliCommand,
  type DiscountsCommand,
  type OrdersDetailsCommand,
  type OrdersItemsCommand,
  type OrdersListCommand,
  type SearchCommand
} from "./cli-commands.js"
import {
  fail,
  helpText,
  isCliRunResult,
  ok,
  parseArgs,
  renderKeepalive,
  type CliKeepaliveOptions,
  type CliLoginOptions,
  type CliOperationOptions,
  type CliPorts,
  type CliRunResult
} from "./cli-model.js"

export { BrowserPollDelayMsSchema, CliRunResultSchema } from "./cli-model.js"
export type {
  BrowserPollDelayMs,
  CliDelay,
  CliKeepaliveOptions,
  CliLoginOptions,
  CliOperationOptions,
  CliPorts,
  CliProgressPort,
  CliRunResult,
  CliStderrWriter
} from "./cli-model.js"
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
} from "./cli-commands.js"

const renderText = (
  name: VoilaOperationName | "auth_login",
  result: Extract<OperationExecutionResult, { readonly ok: true }>
): string => {
  if (name === "auth_login") {
    return "Authenticated session saved.\n"
  }

  if (name === "voila_get_discounted_products") {
    return renderDiscountsText(result)
  }

  return `${JSON.stringify(result.value, undefined, 2)}\n`
}

const render = (
  name: VoilaOperationName | "auth_login",
  result: OperationExecutionResult,
  json: boolean
): CliRunResult => {
  if (!result.ok) {
    return fail(result, json)
  }

  return ok(json ? `${JSON.stringify(result, undefined, 2)}\n` : renderText(name, result))
}

const runOperation = async (
  ports: CliPorts,
  name: VoilaOperationName,
  input: unknown,
  sessionPath: CliOperationOptions["sessionPath"],
  json: boolean
): Promise<CliRunResult> => render(name, await ports.runOperation(name, input, { sessionPath }), json)

const runAuthLogin = async (ports: CliPorts, command: AuthLoginCommand): Promise<CliRunResult> => {
  const options: CliLoginOptions = {
    delay: ports.delay,
    profilePath: command.profilePath,
    progress: { write: ports.writeStderr },
    sessionPath: command.sessionPath,
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs })
  }
  const result = await ports.login(options)

  return render("auth_login", result, command.json)
}

const runAuthStatus = (ports: CliPorts, command: AuthStatusCommand): Promise<CliRunResult> =>
  runOperation(ports, "voila_check_session_health", {}, command.sessionPath, command.json)

const runAuthKeepalive = async (ports: CliPorts, command: AuthKeepaliveCommand): Promise<CliRunResult> => {
  const options: CliKeepaliveOptions = {
    sessionPath: command.sessionPath,
    ...(command.intervalSeconds === undefined ? {} : { intervalSeconds: command.intervalSeconds })
  }

  return renderKeepalive(await ports.keepalive(options))
}

const runSearch = (ports: CliPorts, command: SearchCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_search_products",
    {
      ...(command.pageSize === undefined ? {} : { pageSize: command.pageSize }),
      ...(command.pageToken === undefined ? {} : { pageToken: command.pageToken }),
      query: command.query
    },
    command.sessionPath,
    command.json
  )

const runDiscounts = (ports: CliPorts, command: DiscountsCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_get_discounted_products",
    makeDiscountsOperationInput(command),
    command.sessionPath,
    command.json
  )

const runCategoryProducts = (ports: CliPorts, command: CategoryProductsCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_get_category_products",
    {
      categoryId: command.categoryId,
      ...(command.pageSize === undefined ? {} : { pageSize: command.pageSize }),
      ...(command.pageToken === undefined ? {} : { pageToken: command.pageToken })
    },
    command.sessionPath,
    command.json
  )

const runOrdersList = (ports: CliPorts, command: OrdersListCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_get_completed_orders",
    {
      ...(command.pageSize === undefined ? {} : { pageSize: command.pageSize }),
      ...(command.pageToken === undefined ? {} : { pageToken: command.pageToken })
    },
    command.sessionPath,
    command.json
  )

const runOrdersDetails = (ports: CliPorts, command: OrdersDetailsCommand): Promise<CliRunResult> =>
  runOperation(ports, "voila_get_order_details", { orderId: command.orderId }, command.sessionPath, command.json)

const runOrdersItems = (ports: CliPorts, command: OrdersItemsCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_get_completed_order_items",
    {
      ...(command.fromDate === undefined ? {} : { fromDate: command.fromDate }),
      ...(command.maxOrders === undefined ? {} : { maxOrders: command.maxOrders }),
      ...(command.pageSize === undefined ? {} : { pageSize: command.pageSize }),
      ...(command.pageToken === undefined ? {} : { pageToken: command.pageToken }),
      ...(command.toDate === undefined ? {} : { toDate: command.toDate })
    },
    command.sessionPath,
    command.json
  )

const runCartGet = (ports: CliPorts, command: CartGetCommand): Promise<CliRunResult> =>
  runOperation(ports, "voila_get_cart", {}, command.sessionPath, command.json)

const runCartAdd = (ports: CliPorts, command: CartAddCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_add_cart_items",
    normalizeCliCartInput(command.productId, command.quantity),
    command.sessionPath,
    command.json
  )

const runCartRemove = (ports: CliPorts, command: CartRemoveCommand): Promise<CliRunResult> =>
  runOperation(
    ports,
    "voila_remove_cart_items",
    normalizeCliCartInput(command.productId, command.quantity),
    command.sessionPath,
    command.json
  )

const dispatch = (ports: CliPorts): ((command: CliCommand) => Promise<CliRunResult>) =>
  Match.typeTags<CliCommand>()({
    help: async () => ok(`${helpText}\n`),
    "auth-login": (command) => runAuthLogin(ports, command),
    "auth-status": (command) => runAuthStatus(ports, command),
    "auth-keepalive": (command) => runAuthKeepalive(ports, command),
    search: (command) => runSearch(ports, command),
    discounts: (command) => runDiscounts(ports, command),
    "category-products": (command) => runCategoryProducts(ports, command),
    "orders-list": (command) => runOrdersList(ports, command),
    "orders-details": (command) => runOrdersDetails(ports, command),
    "orders-items": (command) => runOrdersItems(ports, command),
    "cart-get": (command) => runCartGet(ports, command),
    "cart-add": (command) => runCartAdd(ports, command),
    "cart-remove": (command) => runCartRemove(ports, command)
  })

export const runCli = async (args: ReadonlyArray<string>, ports: CliPorts): Promise<CliRunResult> => {
  const parsed = parseArgs(args)

  if (isCliRunResult(parsed)) {
    return parsed
  }

  const command = parseCliCommand(parsed)

  return isCliRunResult(command) ? command : dispatch(ports)(command)
}
