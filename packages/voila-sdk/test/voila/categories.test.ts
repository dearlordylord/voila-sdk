import { readFileSync } from "node:fs"

import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  NormalizedCategoryTreeSchema,
  RawCategoryStoreSchema,
  RawCategoryTreeSchema
} from "../../src/domain/schemas/index.js"
import { getInitialStateCategories, normalizeCategoryStore, normalizeCategoryTree } from "../../src/voila/categories.js"
import { extractInitialState, extractInitialStatePayload } from "../../src/voila/initial-state.js"
import { assertDecodeFailure, assertDecodeSuccess, assertEncodeSuccess } from "../helpers/property.js"

const fixtureHtml = readFileSync(new URL("../fixtures/voila-homepage.html", import.meta.url), "utf8")

interface TestCategoryEntry {
  readonly children: ReadonlyArray<string>
  readonly fullURLPath: string
  readonly id: string
  readonly name: string
  readonly retailerId: string
}

const validEntry: TestCategoryEntry = {
  children: [],
  fullURLPath: "pantry",
  id: "category-id",
  name: "Pantry",
  retailerId: "retailer-category-id"
}

const storeOf = (entries: ReadonlyArray<TestCategoryEntry>, root: ReadonlyArray<string>) => ({
  categories: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
  root
})

const validNestedCategory = {
  categoryId: "category-id",
  name: "Pantry",
  retailerCategoryId: "retailer-category-id",
  urlPath: "pantry"
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

// the page a shopper lands on before the category store has loaded publishes no
// categories at all, so the fixture is republished without that one key
const htmlWithoutCategories = (): string => {
  const payload = extractInitialStatePayload(fixtureHtml)

  if (Result.isFailure(payload) || !isRecord(payload.success) || !isRecord(payload.success.data)) {
    throw new Error("Expected the fixture to carry an initial state")
  }

  const data = Object.fromEntries(Object.entries(payload.success.data).filter(([key]) => key !== "categories"))

  return `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ ...payload.success, data })};</script>`
}

describe("category tree normalization", () => {
  it("resolves root and child categories from homepage initial state", () => {
    const initialState = extractInitialState(fixtureHtml)

    expect(Result.isSuccess(initialState)).toBe(true)

    if (Result.isSuccess(initialState)) {
      const categories = getInitialStateCategories(initialState.success)
      const [produce] = categories
      const [fruit, vegetables] = produce?.children ?? []

      expect(categories).toHaveLength(1)
      expect(produce?.categoryId).toBe("sanitized-category-produce")
      expect(produce?.retailerCategoryId).toBe("retailer-category-produce")
      expect(produce?.name).toBe("Fruits & Vegetables")
      expect(produce?.fullUrlPath).toBe("/aisles/fruits-vegetables")

      expect(fruit?.categoryId).toBe("sanitized-category-fresh-fruit")
      expect(fruit?.retailerCategoryId).toBe("retailer-category-fruit")
      expect(fruit?.fullUrlPath).toBe("/aisles/fruits-vegetables/fresh-fruit")

      expect(vegetables?.categoryId).toBe("sanitized-category-fresh-vegetables")
      expect(vegetables?.retailerCategoryId).toBe("retailer-category-vegetables")
      expect(vegetables?.fullUrlPath).toBe("/aisles/fruits-vegetables/fresh-vegetables")
    }
  })

  it("returns an empty tree when initial state has no categories", () => {
    const initialState = extractInitialState(htmlWithoutCategories())

    expect(Result.isSuccess(initialState)).toBe(true)

    if (Result.isSuccess(initialState)) {
      expect(getInitialStateCategories(initialState.success)).toEqual([])
    }
  })

  it("roots every path exactly once, whatever slashes the page used", () => {
    const categories = normalizeCategoryStore(storeOf([{ ...validEntry, fullURLPath: "/pantry/" }], [validEntry.id]))

    expect(categories[0]?.fullUrlPath).toBe("/pantry")
  })

  it("skips children the store does not hold", () => {
    const categories = normalizeCategoryStore(
      storeOf([{ ...validEntry, children: ["absent-category-id"] }], [validEntry.id, "absent-root-id"])
    )

    expect(categories).toHaveLength(1)
    expect(categories[0]?.children).toEqual([])
  })

  it("stops a store whose children point back up the tree", () => {
    const child: TestCategoryEntry = {
      children: [validEntry.id],
      fullURLPath: "pantry/canned-goods",
      id: "child-category-id",
      name: "Canned Goods",
      retailerId: "child-retailer-category-id"
    }
    const categories = normalizeCategoryStore(
      storeOf([{ ...validEntry, children: [child.id] }, child], [validEntry.id])
    )

    expect(categories[0]?.children[0]?.categoryId).toBe(child.id)
    expect(categories[0]?.children[0]?.children).toEqual([])
  })

  it("keeps resolved categories under the public category schema", () => {
    const child: TestCategoryEntry = {
      children: [],
      fullURLPath: "pantry/canned-goods",
      id: "child-category-id",
      name: "Canned Goods",
      retailerId: "child-retailer-category-id"
    }
    const categories = normalizeCategoryStore(
      storeOf([{ ...validEntry, children: [child.id] }, child], [validEntry.id])
    )

    const decoded = assertDecodeSuccess(NormalizedCategoryTreeSchema, categories)
    expect(assertEncodeSuccess(NormalizedCategoryTreeSchema, decoded)).toEqual(categories)
  })

  it("rejects normalized categories without rooted full URL paths", () => {
    const duplicateSlashResult = Schema.decodeUnknownResult(NormalizedCategoryTreeSchema)([
      {
        categoryId: "category-id",
        children: [],
        fullUrlPath: "//pantry",
        name: "Pantry",
        retailerCategoryId: "retailer-category-id"
      }
    ])

    assertDecodeFailure(NormalizedCategoryTreeSchema, [
      {
        categoryId: "category-id",
        children: [],
        fullUrlPath: "pantry",
        name: "Pantry",
        retailerCategoryId: "retailer-category-id"
      }
    ])

    expect(Result.isFailure(duplicateSlashResult)).toBe(true)

    if (Result.isFailure(duplicateSlashResult)) {
      expect(String(duplicateSlashResult.failure)).toContain(
        "Category full URL path must not start with duplicate slashes"
      )
    }
  })

  it("rejects malformed category stores at the schema boundary", () => {
    for (const entry of [
      { ...validEntry, id: "" },
      { ...validEntry, id: " category-id" },
      { ...validEntry, name: "" },
      { ...validEntry, retailerId: "" },
      { ...validEntry, fullURLPath: "" },
      { ...validEntry, retailerId: validEntry.id }
    ]) {
      assertDecodeFailure(RawCategoryStoreSchema, storeOf([entry], [entry.id]))
    }

    assertDecodeFailure(RawCategoryStoreSchema, { categories: {}, root: [""] })
  })

  it("explains category identifier collisions through schemas", () => {
    const rawResult = Schema.decodeUnknownResult(RawCategoryStoreSchema)(
      storeOf([{ ...validEntry, retailerId: validEntry.id }], [validEntry.id])
    )
    const normalizedResult = Schema.decodeUnknownResult(NormalizedCategoryTreeSchema)([
      {
        categoryId: "category-id",
        children: [],
        fullUrlPath: "/pantry",
        name: "Pantry",
        retailerCategoryId: "category-id"
      }
    ])

    expect(Result.isFailure(rawResult)).toBe(true)
    expect(Result.isFailure(normalizedResult)).toBe(true)

    if (Result.isFailure(rawResult)) {
      expect(String(rawResult.failure)).toContain("Category ID and retailer category ID must be distinct")
    }

    if (Result.isFailure(normalizedResult)) {
      expect(String(normalizedResult.failure)).toContain("Category ID and retailer category ID must be distinct")
    }
  })

  it("resolves the nested shape a page may serve instead of a store", () => {
    const payload = extractInitialStatePayload(fixtureHtml)

    if (Result.isFailure(payload) || !isRecord(payload.success) || !isRecord(payload.success.data)) {
      throw new Error("Expected the fixture to carry an initial state")
    }

    const nested = {
      ...payload.success,
      data: { ...payload.success.data, categories: [{ ...validNestedCategory, categories: [] }] }
    }
    const initialState = extractInitialState(`<script>window.__INITIAL_STATE__ = ${JSON.stringify(nested)};</script>`)

    expect(Result.isSuccess(initialState)).toBe(true)

    if (Result.isSuccess(initialState)) {
      expect(getInitialStateCategories(initialState.success)).toEqual([
        {
          categoryId: "category-id",
          children: [],
          fullUrlPath: "/pantry",
          name: "Pantry",
          retailerCategoryId: "retailer-category-id"
        }
      ])
    }
  })

  it("normalizes nested root URL paths without duplicate slashes", () => {
    expect(normalizeCategoryTree([{ ...validNestedCategory, urlPath: "pantry/" }])[0]?.fullUrlPath).toBe("/pantry")
  })

  it("preserves already-rooted nested child URL paths", () => {
    const categories = normalizeCategoryTree([
      {
        ...validNestedCategory,
        categories: [
          {
            categoryId: "child-category-id",
            name: "Canned Goods",
            retailerCategoryId: "child-retailer-category-id",
            urlPath: "/pantry/canned-goods"
          }
        ]
      }
    ])

    expect(categories[0]?.children[0]?.fullUrlPath).toBe("/pantry/canned-goods")
  })

  it("extends a nested root path onto its children exactly once", () => {
    const categories = normalizeCategoryTree([
      {
        ...validNestedCategory,
        categories: [
          {
            categoryId: "child-category-id",
            name: "Fresh Fruit",
            retailerCategoryId: "child-retailer-category-id",
            urlPath: "fresh-fruit"
          }
        ],
        urlPath: "/"
      }
    ])

    expect(categories[0]?.fullUrlPath).toBe("/")
    expect(categories[0]?.children[0]?.fullUrlPath).toBe("/fresh-fruit")
  })

  it("decodes a nested category with its children and explains a collision", () => {
    const nested = [
      {
        ...validNestedCategory,
        categories: [
          {
            categoryId: "child-category-id",
            name: "Canned Goods",
            retailerCategoryId: "child-retailer-category-id",
            urlPath: "canned-goods"
          }
        ]
      }
    ]

    expect(assertDecodeSuccess(RawCategoryTreeSchema, nested)).toEqual(nested)

    const collision = Schema.decodeUnknownResult(RawCategoryTreeSchema)([
      { ...validNestedCategory, retailerCategoryId: validNestedCategory.categoryId }
    ])

    expect(Result.isFailure(collision)).toBe(true)

    if (Result.isFailure(collision)) {
      expect(String(collision.failure)).toContain("Category ID and retailer category ID must be distinct")
    }
  })

  it("rejects malformed nested categories at the schema boundary", () => {
    for (const category of [
      { ...validNestedCategory, categoryId: "" },
      { ...validNestedCategory, categoryId: " category-id" },
      { ...validNestedCategory, name: "" },
      { ...validNestedCategory, retailerCategoryId: "" },
      { ...validNestedCategory, urlPath: "" },
      { ...validNestedCategory, retailerCategoryId: validNestedCategory.categoryId }
    ]) {
      assertDecodeFailure(RawCategoryTreeSchema, [category])
    }
  })
})
