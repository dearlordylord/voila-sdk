import { Schema } from "effect"

export const MoneySchema = Schema.Struct({
  amount: Schema.String,
  currency: Schema.String
})

export type Money = Schema.Schema.Type<typeof MoneySchema>

export const UnitPriceSchema = Schema.Struct({
  price: MoneySchema,
  unit: Schema.String,
  unitName: Schema.optionalWith(Schema.String, { exact: true })
})

export type UnitPrice = Schema.Schema.Type<typeof UnitPriceSchema>
