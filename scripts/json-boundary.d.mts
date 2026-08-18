import type { Schema } from "effect"

export function parseJson<S extends Schema.Constraint>(schema: S, input: string): Schema.Schema.Type<S>
export function parseJsonValue(input: string): Schema.Json
