import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server"
import { JSONSchema, Schema } from "effect"

export const makeMcpInputSchema = <A, I>(
  schema: Schema.Schema<A, I, never>
): StandardSchemaWithJSON<I, A> => {
  const standardSchema = Schema.standardSchemaV1(schema)
  const jsonSchema: Record<string, unknown> = {
    ...JSONSchema.make(schema, { target: "jsonSchema2020-12" })
  }

  return {
    "~standard": {
      ...standardSchema["~standard"],
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema
      }
    }
  }
}
