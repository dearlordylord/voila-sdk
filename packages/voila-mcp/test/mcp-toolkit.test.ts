import { Effect, Exit, Layer, Schema, Stream } from "effect"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { CategoryIdSchema, OrderIdSchema, ProductUuidSchema, QuerySchema } from "@firfi/voila-sdk"

import { VoilaOperations, voilaToolkit, voilaToolkitLayer } from "../src/mcp-toolkit.js"
import { CartQuantitySchema } from "../src/operation-schemas.js"
import { makeStubEnvironment, unusedTransportLayer } from "./helpers/operations.js"
import type { OperationEnvironment } from "../src/operations.js"

const cartFixture = await readFile(
  new URL("../../voila-sdk/test/fixtures/cart-view-non-empty.json", import.meta.url),
  "utf8"
)

describe("Voila MCP toolkit handlers", () => {
  it("runs a declared handler through the provided operation environment", async () => {
    const environment = makeStubEnvironment(() => Effect.succeed({ body: cartFixture, headers: {}, status: 200 })).env

    const handlers = await Effect.runPromise(
      voilaToolkit.pipe(
        Effect.provide(voilaToolkitLayer.pipe(Layer.provide(Layer.succeed(VoilaOperations, environment))))
      )
    )
    const results = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(handlers.handle("voila_get_cart", {}), Stream.runCollect)).pipe(
        Effect.provideService(VoilaOperations, environment)
      )
    )

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toMatchObject({
      isFailure: false,
      preliminary: false,
      result: { ok: true, value: { basketId: "sanitized-basket-id" } }
    })
  })

  it("routes every declared handler through the operation environment", async () => {
    const environment: OperationEnvironment = {
      session: {
        withAuthenticatedSession: () =>
          Effect.fail({ _tag: "VoilaToolkitTestFailure", message: "session unavailable" }),
        withSession: () => Effect.fail({ _tag: "VoilaToolkitTestFailure", message: "session unavailable" })
      },
      transport: unusedTransportLayer
    }
    const handlers = await Effect.runPromise(
      voilaToolkit.pipe(
        Effect.provide(voilaToolkitLayer.pipe(Layer.provide(Layer.succeed(VoilaOperations, environment))))
      )
    )

    const quantity = Schema.decodeUnknownSync(CartQuantitySchema)(1)
    const consume = async <A, E>(
      call: Effect.Effect<Stream.Stream<A, E, VoilaOperations>, unknown, VoilaOperations>
    ) => {
      const result = await Effect.runPromise(
        Effect.exit(Effect.scoped(Effect.flatMap(call, Stream.runCollect))).pipe(
          Effect.provideService(VoilaOperations, environment)
        )
      )
      expect(Exit.isFailure(result)).toBe(true)
    }

    await consume(
      handlers.handle("voila_add_cart_items", {
        items: [{ productId: ProductUuidSchema.make("11111111-1111-4111-8111-111111111111"), quantity }]
      })
    )
    await consume(handlers.handle("voila_check_session_health", {}))
    await consume(handlers.handle("voila_get_active_shopping_context", {}))
    await consume(handlers.handle("voila_get_cart", {}))
    await consume(handlers.handle("voila_get_category_products", { categoryId: CategoryIdSchema.make("category") }))
    await consume(handlers.handle("voila_get_completed_order_items", {}))
    await consume(handlers.handle("voila_get_completed_orders", {}))
    await consume(handlers.handle("voila_get_discounted_products", {}))
    await consume(handlers.handle("voila_get_order_details", { orderId: OrderIdSchema.make("order") }))
    await consume(
      handlers.handle("voila_get_slot_listings", { deliveryDestinationId: "destination", regionId: "region" })
    )
    await consume(
      handlers.handle("voila_remove_cart_items", {
        items: [{ productId: ProductUuidSchema.make("11111111-1111-4111-8111-111111111111"), quantity }]
      })
    )
    await consume(
      handlers.handle("voila_reserve_slot", {
        allowReservationOverwrite: true,
        confirmSlotReservation: true,
        deliveryDestinationId: "destination",
        regionId: "region",
        slotId: "slot"
      })
    )
    await consume(handlers.handle("voila_search_products", { query: QuerySchema.make("milk") }))
  })
})
