export const mcpName = "io.github.dearlordylord/voila-mcp"

export type VoilaOperationName =
  | "voila_add_cart_items"
  | "voila_check_session_health"
  | "voila_get_cart"
  | "voila_get_category_products"
  | "voila_get_completed_order_items"
  | "voila_get_completed_orders"
  | "voila_get_order_details"
  | "voila_remove_cart_items"
  | "voila_search_products"

export interface VoilaOperationDescriptor {
  readonly description: string
  readonly name: VoilaOperationName
  readonly title: string
}

export const voilaOperationDescriptors: ReadonlyArray<VoilaOperationDescriptor> = [
  {
    description: "Check whether the configured Voila session is active, retryable, expired, or guest-only.",
    name: "voila_check_session_health",
    title: "Check Session Health"
  },
  {
    description: "Search Voila products by text query for the current session context.",
    name: "voila_search_products",
    title: "Search Products"
  },
  {
    description: "Fetch products for a Voila category id for the current session context.",
    name: "voila_get_category_products",
    title: "Get Category Products"
  },
  {
    description: "Fetch completed Voila orders with cursor pagination for the authenticated account.",
    name: "voila_get_completed_orders",
    title: "Get Completed Orders"
  },
  {
    description: "Fetch item-level details for one completed Voila order by order id.",
    name: "voila_get_order_details",
    title: "Get Order Details"
  },
  {
    description: "Aggregate previously ordered items across completed orders, optionally within a date range.",
    name: "voila_get_completed_order_items",
    title: "Get Completed Order Items"
  },
  {
    description: "Fetch the current active cart with totals, limited items, unavailable data, and pricing notices.",
    name: "voila_get_cart",
    title: "Get Cart"
  },
  {
    description: "Add product quantity deltas to the active cart using Voila product UUIDs.",
    name: "voila_add_cart_items",
    title: "Add Cart Items"
  },
  {
    description: "Remove product quantity deltas from the active cart using Voila product UUIDs.",
    name: "voila_remove_cart_items",
    title: "Remove Cart Items"
  }
]
