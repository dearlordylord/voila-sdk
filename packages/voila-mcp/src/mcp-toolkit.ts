import { Context, Effect, type Layer, Option, Schema } from "effect"
import { McpSchema, Tool, Toolkit } from "effect/unstable/ai"

import {
  type VoilaOperationDescriptor,
  type VoilaOperationName,
  voilaOperationDescriptors
} from "./operation-descriptors.js"
import {
  ActiveShoppingContextOperationInputSchema,
  CartItemOperationInputSchema,
  CategoryProductsOperationInputSchema,
  DiscountedProductsOperationInputSchema,
  EmptyOperationInputSchema,
  OrderDetailsOperationInputSchema,
  OrderItemsOperationInputSchema,
  OrderListOperationInputSchema,
  ProductListOperationInputSchema,
  SlotListingsOperationInputSchema,
  SlotReservationOperationInputSchema
} from "./operation-schemas.js"
import {
  type OperationEnvironment,
  type OperationExecutionFailure,
  OperationExecutionFailureSchema,
  OperationExecutionSuccessSchema,
  runVoilaOperation
} from "./operations.js"

/**
 * The environment the tool handlers run against. A tag rather than a closure
 * argument: the toolkit is built once at module scope, and the process that
 * knows what a session file and a network stack are provides them when it
 * builds its layers.
 */
export class VoilaOperations extends Context.Service<VoilaOperations, OperationEnvironment>()(
  "@firfi/voila-mcp/VoilaOperations"
) {}

/**
 * Effect 4's MCP adapter only renders declared failures whose runtime value is
 * also an Error. Keep the operation failure schema as the source of truth while
 * giving the adapter a redacted, schema-shaped Error boundary. The operation
 * layer has already removed request material from this value before it reaches
 * the toolkit.
 */
class OperationExecutionFailureError extends Error {
  readonly ok = false
  readonly error: OperationExecutionFailure["error"]

  constructor(failure: OperationExecutionFailure) {
    super(JSON.stringify(failure))
    this.name = "OperationExecutionFailure"
    this.error = failure.error
  }
}

const descriptorFor = (name: VoilaOperationName): VoilaOperationDescriptor => {
  const descriptor = voilaOperationDescriptors.find((operation) => operation.name === name)

  if (descriptor === undefined) {
    throw new Error(`Missing Voila operation descriptor for ${name}`)
  }

  return descriptor
}

/**
 * MCP emits all four behaviour hints on every tool whether or not we set them,
 * and its defaults are the cautious ones — `destructive` and `openWorld` are
 * true unless said otherwise. So every tool states all four: a read-only tool
 * that stayed silent would be advertised to clients as destructive.
 *
 * `openWorld` is true for every Voila tool, read or write: the answers come
 * from a live storefront whose catalogue, prices, and slots move without us.
 */
const makeTool = <Name extends VoilaOperationName, Parameters extends Schema.Constraint>(
  name: Name,
  parameters: Parameters,
  readOnly: boolean
) => {
  const descriptor = descriptorFor(name)

  return Tool.make(name, {
    dependencies: [VoilaOperations],
    description: descriptor.description,
    failure: OperationExecutionFailureSchema,
    parameters,
    success: OperationExecutionSuccessSchema
  })
    .annotate(Tool.Title, descriptor.title)
    .annotate(Tool.Readonly, readOnly)
    .annotate(Tool.Destructive, !readOnly)
    .annotate(Tool.Idempotent, readOnly)
    .annotate(Tool.OpenWorld, true)
}

const readOnlyTool = true
const mutationTool = false

export const voilaToolkit = Toolkit.make(
  makeTool("voila_check_session_health", EmptyOperationInputSchema, readOnlyTool),
  makeTool("voila_get_active_shopping_context", ActiveShoppingContextOperationInputSchema, readOnlyTool),
  makeTool("voila_get_slot_listings", SlotListingsOperationInputSchema, readOnlyTool),
  makeTool("voila_reserve_slot", SlotReservationOperationInputSchema, mutationTool),
  makeTool("voila_search_products", ProductListOperationInputSchema, readOnlyTool),
  makeTool("voila_get_category_products", CategoryProductsOperationInputSchema, readOnlyTool),
  makeTool("voila_get_discounted_products", DiscountedProductsOperationInputSchema, readOnlyTool),
  makeTool("voila_get_completed_orders", OrderListOperationInputSchema, readOnlyTool),
  makeTool("voila_get_order_details", OrderDetailsOperationInputSchema, readOnlyTool),
  makeTool("voila_get_completed_order_items", OrderItemsOperationInputSchema, readOnlyTool),
  makeTool("voila_get_cart", EmptyOperationInputSchema, readOnlyTool),
  makeTool("voila_add_cart_items", CartItemOperationInputSchema, mutationTool),
  makeTool("voila_remove_cart_items", CartItemOperationInputSchema, mutationTool)
)

const runTool = (
  name: VoilaOperationName,
  input: unknown
): Effect.Effect<
  Schema.Schema.Type<typeof OperationExecutionSuccessSchema>,
  Schema.Schema.Type<typeof OperationExecutionFailureSchema>,
  VoilaOperations
> =>
  VoilaOperations.use((env) =>
    runVoilaOperation(name, input, env).pipe(Effect.mapError((failure) => new OperationExecutionFailureError(failure)))
  )

/**
 * One handler per tool, all of them the same handler: parse-and-run belongs to
 * the operation registry, not here. The toolkit's job is to say which names
 * exist and what they accept.
 */
export const voilaToolkitLayer: Layer.Layer<
  Tool.HandlersFor<typeof voilaToolkit.tools>,
  never,
  VoilaOperations
> = voilaToolkit.toLayer({
  voila_add_cart_items: (input) => runTool("voila_add_cart_items", input),
  voila_check_session_health: (input) => runTool("voila_check_session_health", input),
  voila_get_active_shopping_context: (input) => runTool("voila_get_active_shopping_context", input),
  voila_get_cart: (input) => runTool("voila_get_cart", input),
  voila_get_category_products: (input) => runTool("voila_get_category_products", input),
  voila_get_completed_order_items: (input) => runTool("voila_get_completed_order_items", input),
  voila_get_completed_orders: (input) => runTool("voila_get_completed_orders", input),
  voila_get_discounted_products: (input) => runTool("voila_get_discounted_products", input),
  voila_get_order_details: (input) => runTool("voila_get_order_details", input),
  voila_get_slot_listings: (input) => runTool("voila_get_slot_listings", input),
  voila_remove_cart_items: (input) => runTool("voila_remove_cart_items", input),
  voila_reserve_slot: (input) => runTool("voila_reserve_slot", input),
  voila_search_products: (input) => runTool("voila_search_products", input)
})

export interface VoilaMcpToolRecord {
  readonly annotations: Context.Context<never>
  readonly name: VoilaOperationName
  readonly tool: McpSchema.Tool
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const lastArrayIndex = -1

/**
 * RC.110 represents independent checks as `allOf` fragments. Effect 3 exposed
 * those non-conflicting constraints directly, which is the Draft-07 shape
 * existing MCP clients received. Ambiguous schema composition stays intact.
 */
const projectDraft07Constraints = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(projectDraft07Constraints)
  }
  if (!isRecord(value)) {
    return value
  }

  const projected = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, projectDraft07Constraints(child)])
  )
  if (!Array.isArray(projected.allOf) || !projected.allOf.every(isRecord)) {
    return projected
  }

  const base = Object.fromEntries(Object.entries(projected).filter(([key]) => key !== "allOf"))
  const fragmentEntries = projected.allOf.map(Object.entries)
  const lastIndexFor = (key: string): number =>
    fragmentEntries.findLastIndex((entries) => entries.some(([candidate]) => candidate === key))
  const promoted = fragmentEntries.flatMap((entries, index) =>
    entries.filter(([key]) => lastIndexFor(key) === index && !(key in base))
  )
  const baseWithPromoted = Object.fromEntries([...Object.entries(base), ...promoted])
  const residual = fragmentEntries.flatMap((entries, index) => {
    // A key already present in the base is an independent constraint, not a
    // duplicate that can be discarded. Keep every such fragment so projection
    // cannot weaken a schema when a future refinement repeats a base keyword.
    const retained = Object.fromEntries(entries.filter(([key]) => key in base || lastIndexFor(key) !== index))
    return Object.keys(retained).length === 0 ? [] : [retained]
  })
  return residual.length === 0 ? baseWithPromoted : { ...baseWithPromoted, allOf: residual }
}

type LegacyDescriptionRule = (
  value: Readonly<Record<string, unknown>>,
  fieldName: string | undefined
) => Readonly<Record<string, unknown>> | undefined

const stringDescription: LegacyDescriptionRule = (value) => {
  if (value.type === "string" && typeof value.minLength === "number") {
    const description =
      typeof value.pattern === "string" && value.pattern.startsWith("^\\d{4}")
        ? `a string matching the pattern ${value.pattern}`
        : `a string at least ${value.minLength} character(s) long`
    return { ...value, description, title: `minLength(${value.minLength})` }
  }
  return undefined
}

const maximumDescription: LegacyDescriptionRule = (value) => {
  if ((value.type === "integer" || value.type === "number") && typeof value.maximum === "number") {
    return {
      ...value,
      description: `a number less than or equal to ${value.maximum}`,
      title: `lessThanOrEqualTo(${value.maximum})`
    }
  }
  return undefined
}

const minimumDescription: LegacyDescriptionRule = (value) => {
  if ((value.type === "integer" || value.type === "number") && value.minimum === 0) {
    return { ...value, description: "a non-negative number", title: "nonNegative" }
  }
  return undefined
}

const exclusiveMinimumDescription: LegacyDescriptionRule = (value, fieldName) => {
  if ((value.type === "integer" || value.type === "number") && value.exclusiveMinimum === 0) {
    return {
      ...value,
      description: "a positive number",
      title: fieldName === "quantity" ? "greaterThan(0)" : "positive"
    }
  }
  return undefined
}

const arrayDescription: LegacyDescriptionRule = (value) => {
  if (value.type === "array" && typeof value.minItems === "number") {
    return {
      ...value,
      description: `an array of at least ${value.minItems} item(s)`,
      title: `minItems(${value.minItems})`
    }
  }
  return undefined
}

const externalAddressDescription: LegacyDescriptionRule = (value, fieldName) => {
  if (value.type === "object" && fieldName === "externalAddress") {
    return {
      ...value,
      additionalProperties: { $id: "/schemas/unknown", title: "unknown" },
      properties: {},
      required: []
    }
  }
  return undefined
}

const legacyDescriptionRules: ReadonlyArray<LegacyDescriptionRule> = [
  stringDescription,
  maximumDescription,
  minimumDescription,
  exclusiveMinimumDescription,
  arrayDescription,
  externalAddressDescription
]

const legacyDescription = (value: Readonly<Record<string, unknown>>, path: ReadonlyArray<string>) => {
  const fieldName = path.at(lastArrayIndex)
  for (const rule of legacyDescriptionRules) {
    const projected = rule(value, fieldName)
    if (projected !== undefined) return projected
  }
  return value
}

const projectLegacyDescriptions = (value: unknown, path: ReadonlyArray<string> = []): unknown => {
  if (Array.isArray(value)) {
    return value.map((child) => projectLegacyDescriptions(child, path))
  }
  if (!isRecord(value)) {
    return value
  }
  const children = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, projectLegacyDescriptions(child, [...path, key])])
  )
  return legacyDescription(children, path)
}

const projectToolInputSchema = (value: unknown): unknown => {
  const projected = projectLegacyDescriptions(projectDraft07Constraints(value))
  return isRecord(projected) && projected.type === "object"
    ? {
        ...projected,
        ...(projected.properties === undefined ? { properties: {} } : {}),
        ...(projected.required === undefined ? { required: [] } : {})
      }
    : projected
}

const makeVoilaMcpToolRecord = (name: VoilaOperationName): VoilaMcpToolRecord => {
  const tool = voilaToolkit.tools[name]
  const title = Option.getOrUndefined(Context.getOption(tool.annotations, Tool.Title))
  const description = Tool.getDescription(tool)
  const inputSchema = Schema.decodeUnknownSync(McpSchema.ToolJsonSchema)(
    projectToolInputSchema(Tool.getJsonSchema(tool))
  )

  return {
    annotations: tool.annotations,
    name,
    tool: new McpSchema.Tool({
      annotations: {
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        ...(title === undefined ? {} : { title })
      },
      description,
      inputSchema,
      name
    })
  }
}

/** The single metadata projection used by HTTP discovery and native MCP registration. */
export const voilaMcpTools: ReadonlyArray<VoilaMcpToolRecord> = voilaOperationDescriptors.map((descriptor) =>
  makeVoilaMcpToolRecord(descriptor.name)
)
