import { expect, test } from "vitest"

import { captureOracleCorpus, wireDraft07Schemas, wireToolSchemas } from "./oracle-probe.mjs"
import { validateDraft07 } from "./oracle-core.mjs"

test("extracts the actual wire tools/list input and output schemas", async () => {
  const schemas = wireToolSchemas({
    listed: {
      body: {
        result: {
          tools: [
            {
              inputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" },
              name: "voila_example",
              outputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" }
            }
          ]
        }
      }
    }
  })
  expect(Object.keys(schemas)).toEqual(["voila_example.wire.input", "voila_example.wire.output"])
  await expect(validateDraft07(schemas)).resolves.toBeUndefined()
})

test("converts a Draft-2020 wire schema to Draft-07 only for validation", async () => {
  const protocol = {
    listed: {
      body: {
        result: {
          tools: [
            {
              inputSchema: {
                $defs: { label: { type: "string" } },
                $schema: "https://json-schema.org/draft/2020-12/schema",
                additionalProperties: false,
                properties: { label: { $ref: "#/$defs/label" } },
                required: ["label"],
                type: "object"
              },
              name: "voila_example"
            }
          ]
        }
      }
    }
  }
  expect(wireToolSchemas(protocol)["voila_example.wire.input"]).toMatchObject({ $defs: { label: { type: "string" } } })
  expect(wireDraft07Schemas(protocol)["voila_example.wire.input"]).toMatchObject({
    definitions: { label: { type: "string" } },
    properties: { label: { $ref: "#/definitions/label" } }
  })
  await expect(validateDraft07(wireDraft07Schemas(protocol))).resolves.toBeUndefined()
})

test("rejects a tools/list tool without a wire input schema", () => {
  expect(() => wireToolSchemas({ listed: { body: { result: { tools: [{ name: "voila_example" }] } } } })).toThrow(
    "omitted its inputSchema"
  )
})

test("captures the public built-artifact oracle corpus", async () => {
  const corpus = await captureOracleCorpus()

  expect(corpus.mcp.tools).toHaveLength(13)
  expect(corpus.mcp.tools.map((tool) => tool.name)).toEqual([
    "voila_check_session_health",
    "voila_get_active_shopping_context",
    "voila_get_slot_listings",
    "voila_reserve_slot",
    "voila_search_products",
    "voila_get_category_products",
    "voila_get_discounted_products",
    "voila_get_completed_orders",
    "voila_get_order_details",
    "voila_get_completed_order_items",
    "voila_get_cart",
    "voila_add_cart_items",
    "voila_remove_cart_items"
  ])
  expect(corpus.mcp.protocol.health).toEqual([
    { body: { name: "io.github.dearlordylord/voila-mcp", status: "ok" }, status: 200 },
    { body: { name: "io.github.dearlordylord/voila-mcp", status: "ok" }, status: 200 }
  ])
  expect(corpus.mcp.protocol.succeeded.body).toBeDefined()
  expect(corpus.mcp.protocol.foreignOrigin.status).toBe(403)
  expect(corpus.stdio.initialize.result.serverInfo.name).toBe("io.github.dearlordylord/voila-mcp")
  expect(corpus.cli.results).toHaveLength(7)
  expect(corpus.sdk.parsed["catalog-search"]._tag).toBe("Right")
  expect(corpus.sdk.codec.guestDiagnostic.csrf).toBe("[redacted]")
  expect(corpus.artifacts).toHaveLength(3)
  expect(corpus.artifacts.every((artifact) => artifact.files.length > 0)).toBe(true)
}, 15_000)
