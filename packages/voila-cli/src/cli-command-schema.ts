import {
  BrowserLoginTimeoutMsSchema,
  CategoryIdSchema,
  DiscountPageSizeSchema,
  DiscountSavingsAmountSchema,
  DiscountSavingsPercentSchema,
  DiscountSortSchema,
  KeepaliveIntervalSecondsSchema,
  IsoDateStringSchema,
  OrderIdSchema,
  PageTokenSchema,
  ProductUuidSchema,
  QuerySchema
} from "@firfi/voila-sdk"
import { CartQuantitySchema, MaxOrdersSchema, OrderPageSizeSchema, ProductPageSizeSchema } from "@firfi/voila-mcp"
import { StateFilePathSchema } from "@firfi/voila-session-store"
import { Result, Schema, SchemaGetter } from "effect"

import { defaultBrowserProfilePath, defaultSessionPath } from "./defaults.js"
import {
  getOptionValue,
  hasFlag,
  isCliRunResult,
  usage,
  type CliFlag,
  type CliParsedOptions,
  type CliRunResult,
  type CliValueOptionName
} from "./cli-model.js"

const NonEmptyTrimmedStringSchema = Schema.Trimmed.check(Schema.isNonEmpty())
const IntegerStringSchema = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/))
const DecimalStringSchema = Schema.String.check(Schema.isPattern(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/))

const integerTo = <S extends Schema.ConstraintDecoder<number>>(schema: S) =>
  IntegerStringSchema.pipe(
    Schema.decodeTo(schema, { decode: SchemaGetter.transform(Number), encode: SchemaGetter.transform(String) })
  )

const decimalTo = <S extends Schema.ConstraintDecoder<number>>(schema: S) =>
  DecimalStringSchema.pipe(
    Schema.decodeTo(schema, { decode: SchemaGetter.transform(Number), encode: SchemaGetter.transform(String) })
  )

const ProductPageSizeFromStringSchema = integerTo(ProductPageSizeSchema)
const DiscountPageSizeFromStringSchema = integerTo(DiscountPageSizeSchema)
const OrderPageSizeFromStringSchema = integerTo(OrderPageSizeSchema)
const MaxOrdersFromStringSchema = integerTo(MaxOrdersSchema)
const CartQuantityFromStringSchema = integerTo(CartQuantitySchema)
const BrowserLoginTimeoutFromStringSchema = integerTo(BrowserLoginTimeoutMsSchema)
const DiscountSavingsAmountFromStringSchema = decimalTo(DiscountSavingsAmountSchema)
const DiscountSavingsPercentFromStringSchema = decimalTo(DiscountSavingsPercentSchema)

const CliCommandSchema = Schema.TaggedUnion({
  help: {},
  "auth-login": {
    json: Schema.Boolean,
    profilePath: NonEmptyTrimmedStringSchema,
    sessionPath: StateFilePathSchema,
    timeoutMs: Schema.optionalKey(BrowserLoginTimeoutFromStringSchema)
  },
  "auth-status": { json: Schema.Boolean, sessionPath: StateFilePathSchema },
  "auth-keepalive": {
    intervalSeconds: Schema.optionalKey(KeepaliveIntervalSecondsSchema),
    sessionPath: StateFilePathSchema
  },
  search: {
    json: Schema.Boolean,
    pageSize: Schema.optionalKey(ProductPageSizeFromStringSchema),
    pageToken: Schema.optionalKey(PageTokenSchema),
    query: QuerySchema,
    sessionPath: StateFilePathSchema
  },
  discounts: {
    json: Schema.Boolean,
    minSavingsAmount: Schema.optionalKey(DiscountSavingsAmountFromStringSchema),
    minSavingsPercent: Schema.optionalKey(DiscountSavingsPercentFromStringSchema),
    pageSize: Schema.optionalKey(DiscountPageSizeFromStringSchema),
    pageToken: Schema.optionalKey(PageTokenSchema),
    query: Schema.optionalKey(QuerySchema),
    sessionPath: StateFilePathSchema,
    sort: Schema.optionalKey(DiscountSortSchema)
  },
  "category-products": {
    categoryId: CategoryIdSchema,
    json: Schema.Boolean,
    pageSize: Schema.optionalKey(ProductPageSizeFromStringSchema),
    pageToken: Schema.optionalKey(PageTokenSchema),
    sessionPath: StateFilePathSchema
  },
  "orders-list": {
    json: Schema.Boolean,
    pageSize: Schema.optionalKey(OrderPageSizeFromStringSchema),
    pageToken: Schema.optionalKey(PageTokenSchema),
    sessionPath: StateFilePathSchema
  },
  "orders-details": { json: Schema.Boolean, orderId: OrderIdSchema, sessionPath: StateFilePathSchema },
  "orders-items": {
    fromDate: Schema.optionalKey(IsoDateStringSchema),
    json: Schema.Boolean,
    maxOrders: Schema.optionalKey(MaxOrdersFromStringSchema),
    pageSize: Schema.optionalKey(OrderPageSizeFromStringSchema),
    pageToken: Schema.optionalKey(PageTokenSchema),
    sessionPath: StateFilePathSchema,
    toDate: Schema.optionalKey(IsoDateStringSchema)
  },
  "cart-get": { json: Schema.Boolean, sessionPath: StateFilePathSchema },
  "cart-add": {
    json: Schema.Boolean,
    productId: ProductUuidSchema,
    quantity: CartQuantityFromStringSchema,
    sessionPath: StateFilePathSchema
  },
  "cart-remove": {
    json: Schema.Boolean,
    productId: ProductUuidSchema,
    quantity: CartQuantityFromStringSchema,
    sessionPath: StateFilePathSchema
  }
})

export type CliCommand = Schema.Schema.Type<typeof CliCommandSchema>
export type AuthLoginCommand = Extract<CliCommand, { readonly _tag: "auth-login" }>
export type AuthStatusCommand = Extract<CliCommand, { readonly _tag: "auth-status" }>
export type AuthKeepaliveCommand = Extract<CliCommand, { readonly _tag: "auth-keepalive" }>
export type SearchCommand = Extract<CliCommand, { readonly _tag: "search" }>
export type DiscountsCommand = Extract<CliCommand, { readonly _tag: "discounts" }>
export type CategoryProductsCommand = Extract<CliCommand, { readonly _tag: "category-products" }>
export type OrdersListCommand = Extract<CliCommand, { readonly _tag: "orders-list" }>
export type OrdersDetailsCommand = Extract<CliCommand, { readonly _tag: "orders-details" }>
export type OrdersItemsCommand = Extract<CliCommand, { readonly _tag: "orders-items" }>
export type CartGetCommand = Extract<CliCommand, { readonly _tag: "cart-get" }>
export type CartAddCommand = Extract<CliCommand, { readonly _tag: "cart-add" }>
export type CartRemoveCommand = Extract<CliCommand, { readonly _tag: "cart-remove" }>

type CommandForTag<Tag extends CliCommand["_tag"]> = Extract<CliCommand, { readonly _tag: Tag }>
type CommandOptionName<Tag extends CliCommand["_tag"]> = Exclude<Extract<keyof CommandForTag<Tag>, string>, "_tag">

export const RootCommandSchema = Schema.Literals(["auth", "cart", "category", "discounts", "orders", "search"])
export const AuthCommandSchema = Schema.Literals(["login", "status", "keepalive"])
export const CartCommandSchema = Schema.Literals(["get", "add", "remove"])
export const OrderCommandSchema = Schema.Literals(["list", "details", "items"])

export const optionField = <Tag extends Exclude<CliCommand["_tag"], "help">>(
  _tag: Tag,
  name: CommandOptionName<Tag>,
  value: string | undefined
): Readonly<Record<string, string>> => (value === undefined ? {} : { [name]: value })

export const sessionField = (
  _tag: Exclude<CliCommand["_tag"], "help">,
  parsed: CliParsedOptions
): Readonly<Record<string, string>> => ({ sessionPath: getOptionValue(parsed, "session") ?? defaultSessionPath() })

export const decodeCommand = (candidate: unknown, message: string): CliCommand | CliRunResult => {
  const decoded = Schema.decodeUnknownResult(CliCommandSchema)(candidate)

  return Result.isFailure(decoded) ? usage(message) : decoded.success
}

export const decodeHelp = (): CliCommand | CliRunResult => decodeCommand({ _tag: "help" }, "Invalid help command")

export const routeValidation = (
  parsed: CliParsedOptions,
  route: string,
  allowedFlags: ReadonlyArray<CliFlag>,
  allowedOptions: ReadonlyArray<CliValueOptionName>,
  minimumPositionals: number,
  maximumPositionals: number
): CliRunResult | undefined => {
  const illegalFlag = parsed.flags.find((flag) => !allowedFlags.includes(flag))

  if (illegalFlag !== undefined) {
    return usage(`--${illegalFlag} is not valid for ${route}`)
  }

  const illegalOption = parsed.options.find(([option]) => !allowedOptions.includes(option))?.[0]

  if (illegalOption !== undefined) {
    return usage(`--${illegalOption} is not valid for ${route}`)
  }

  if (parsed.positionals.length > maximumPositionals) {
    return usage(`${route} does not accept positional arguments`)
  }

  return parsed.positionals.length < minimumPositionals ? usage(`Missing arguments for ${route}`) : undefined
}

export const withHelp = (parsed: CliParsedOptions, command: CliCommand | CliRunResult): CliCommand | CliRunResult =>
  isCliRunResult(command) ? command : hasFlag(parsed, "help") ? decodeHelp() : command

export const commandMessage = (
  parsed: CliParsedOptions,
  messages: ReadonlyArray<readonly [CliValueOptionName, string]>,
  fallback: string
): string => {
  const matched = messages.find(([name]) => getOptionValue(parsed, name) !== undefined)

  if (matched !== undefined) {
    return matched[1]
  }

  return getOptionValue(parsed, "session") === undefined
    ? fallback
    : "--session must be an absolute path to a session file"
}

export const browserProfilePath = (parsed: CliParsedOptions): string =>
  getOptionValue(parsed, "profile") ?? defaultBrowserProfilePath()
