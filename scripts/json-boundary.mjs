import { Schema } from "effect"

/** Decode JSON text and its payload contract in one schema-owned boundary. */
export const parseJson = (schema, input) => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(input)

/** Decode JSON whose intentionally open contract is any JSON-compatible value. */
export const parseJsonValue = (input) => parseJson(Schema.Json, input)
