import { Schema } from "effect"

const UnknownStringRecordSchema = Schema.Record(Schema.String, Schema.Unknown)

/** Preserve Voila's forward-compatible object payloads with unknown string keys. */
export const withUnknownStringFields = <S extends Schema.StructWithRest.Objects>(schema: S) =>
  Schema.StructWithRest(schema, [UnknownStringRecordSchema])
