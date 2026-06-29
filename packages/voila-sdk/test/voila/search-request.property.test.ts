import { Either } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import { MAX_SEARCH_PAGE_SIZE, MIN_SEARCH_PAGE_SIZE } from "../../src/domain/schemas/index.js"
import { makeSearchRequest } from "../../src/voila/urls.js"
import { propertyTestParameters } from "../helpers/property.js"

const safeSearchCharacter = fc.constantFrom(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  " ",
  "&",
  "%",
  "+",
  "?",
  "#",
  "=",
  "/",
  "-",
  "é",
  "ç",
  "豆"
)

const safeTokenCharacter = fc.constantFrom(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "-",
  "_"
)

const trimmedText = (character: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  fc.tuple(
    character.filter((value) => value !== " "),
    fc.array(character, { maxLength: 12 }),
    character.filter((value) => value !== " ")
  ).map(([first, middle, last]) => [first, ...middle, last].join(""))

const categoryContextArbitrary = fc.oneof(
  fc.record({
    categoryId: trimmedText(safeTokenCharacter)
  }),
  fc.record({
    retailerCategoryId: trimmedText(safeTokenCharacter)
  }),
  fc.record({
    categoryId: trimmedText(safeTokenCharacter),
    retailerCategoryId: trimmedText(safeTokenCharacter)
  })
)

const optionalPageTokenArbitrary = fc.oneof(
  fc.constant({}),
  fc.record({
    pageToken: trimmedText(safeTokenCharacter)
  })
)

const optionalCategoryContextArbitrary = fc.oneof(
  fc.constant({}),
  fc.record({
    categoryContext: categoryContextArbitrary
  })
)

const requiredSearchInputArbitrary = fc.record({
  pageSize: fc.integer({ max: MAX_SEARCH_PAGE_SIZE, min: MIN_SEARCH_PAGE_SIZE }),
  query: trimmedText(safeSearchCharacter)
})

const searchInputArbitrary = fc.tuple(
  requiredSearchInputArbitrary,
  optionalPageTokenArbitrary,
  optionalCategoryContextArbitrary
).map(([required, pageToken, categoryContext]) => ({
  ...required,
  ...pageToken,
  ...categoryContext
}))

describe("search request properties", () => {
  it("builds stable equivalent requests and preserves decoded query parameters", () => {
    fc.assert(
      fc.property(searchInputArbitrary, (input) => {
        const first = makeSearchRequest(input)
        const second = makeSearchRequest(input)

        expect(Either.isRight(first)).toBe(true)
        expect(Either.isRight(second)).toBe(true)

        if (Either.isRight(first) && Either.isRight(second)) {
          expect(first.right.url.href).toBe(second.right.url.href)
          expect(first.right.url.pathname).toBe("/api/webproductpagews/v6/product-pages/search")
          expect(first.right.url.searchParams.get("q")).toBe(input.query)
          expect(first.right.url.searchParams.get("maxPageSize")).toBe(String(input.pageSize))

          if ("pageToken" in input) {
            expect(first.right.url.searchParams.get("pageToken")).toBe(input.pageToken)
          }

          if ("categoryContext" in input) {
            if ("categoryId" in input.categoryContext) {
              expect(first.right.url.searchParams.get("categoryId")).toBe(input.categoryContext.categoryId)
            }

            if ("retailerCategoryId" in input.categoryContext) {
              expect(first.right.url.searchParams.get("retailerCategoryId")).toBe(
                input.categoryContext.retailerCategoryId
              )
            }
          }
        }
      }),
      propertyTestParameters
    )
  })
})
