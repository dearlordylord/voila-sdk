export const mcpName = "io.github.dearlordylord/voila-mcp"

export type VoilaOperationName =
  | "voila_add_cart_items"
  | "voila_check_session_health"
  | "voila_get_active_shopping_context"
  | "voila_get_cart"
  | "voila_get_category_products"
  | "voila_get_discounted_products"
  | "voila_get_completed_order_items"
  | "voila_get_completed_orders"
  | "voila_get_order_details"
  | "voila_get_slot_listings"
  | "voila_remove_cart_items"
  | "voila_reserve_slot"
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
    description:
      "Read the active Voila delivery and cart context. Preferred first step for order planning before product discovery because availability and pricing are session and slot-context sensitive.",
    name: "voila_get_active_shopping_context",
    title: "Get Active Shopping Context"
  },
  {
    description:
      "List available Voila delivery slots for an explicit delivery destination and region. Preferred first step for order planning; this is read-only and does not reserve a slot.",
    name: "voila_get_slot_listings",
    title: "Get Slot Listings"
  },
  {
    description:
      "Reserve a caller-selected Voila delivery slot. This is a mutation and should only be called after a latest slot listing and explicit user confirmation.",
    name: "voila_reserve_slot",
    title: "Reserve Slot"
  },
  {
    description:
      "Search Voila products by text query for the current session context. Product availability and pricing are session and slot-context sensitive, so prefer checking slots first when planning an order.",
    name: "voila_search_products",
    title: "Search Products"
  },
  {
    description:
      "Fetch products for a Voila category id for the current session context. Product availability and pricing are session and slot-context sensitive, so prefer checking slots first when planning an order.",
    name: "voila_get_category_products",
    title: "Get Category Products"
  },
  {
    description:
      "Fetch discounted Voila products from promotions. Product availability and pricing are session and slot-context sensitive, so prefer checking slots first when planning an order. By default returns only meaningful discounts ($0.50 or 10% savings); lower thresholds only when the user asks. Query matches are filtered locally and include scan metadata.",
    name: "voila_get_discounted_products",
    title: "Get Discounted Products"
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
