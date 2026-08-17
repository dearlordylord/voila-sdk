import { Tool, Toolkit } from "@effect/ai"
import { Context, Effect, type Layer, type Schema } from "effect"

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
  OrderDetailsOperationInputSchema,
  OrderItemsOperationInputSchema,
  OrderListOperationInputSchema,
  ProductListOperationInputSchema,
  SlotListingsOperationInputSchema,
  SlotReservationOperationInputSchema
} from "./operation-schemas.js"
import {
  type OperationEnvironment,
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
export class VoilaOperations extends Context.Tag("@firfi/voila-mcp/VoilaOperations")<
  VoilaOperations,
  OperationEnvironment
>() {}

const noParameters = {}

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
const makeTool = <Name extends VoilaOperationName, Parameters extends Schema.Struct.Fields>(
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
  makeTool("voila_check_session_health", noParameters, readOnlyTool),
  makeTool("voila_get_active_shopping_context", ActiveShoppingContextOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_slot_listings", SlotListingsOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_reserve_slot", SlotReservationOperationInputSchema.fields, mutationTool),
  makeTool("voila_search_products", ProductListOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_category_products", CategoryProductsOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_discounted_products", DiscountedProductsOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_completed_orders", OrderListOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_order_details", OrderDetailsOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_completed_order_items", OrderItemsOperationInputSchema.fields, readOnlyTool),
  makeTool("voila_get_cart", noParameters, readOnlyTool),
  makeTool("voila_add_cart_items", CartItemOperationInputSchema.fields, mutationTool),
  makeTool("voila_remove_cart_items", CartItemOperationInputSchema.fields, mutationTool)
)

const runTool = (
  name: VoilaOperationName,
  input: unknown
): Effect.Effect<
  Schema.Schema.Type<typeof OperationExecutionSuccessSchema>,
  Schema.Schema.Type<typeof OperationExecutionFailureSchema>,
  VoilaOperations
> => VoilaOperations.pipe(Effect.flatMap((env) => runVoilaOperation(name, input, env)))

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
