import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { parseJson } from "../../src/domain/parse.js"

describe("parseJson", () => {
  it("parses JSON text into unknown boundary data", () => {
    const result = parseJson('{"ok":true}')

    expect(Result.isSuccess(result)).toBe(true)
  })

  it("returns an error for malformed JSON", () => {
    const result = parseJson("{")

    expect(Result.isFailure(result)).toBe(true)
  })
})
