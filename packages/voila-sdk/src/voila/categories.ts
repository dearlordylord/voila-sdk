import type {
  InitialState,
  NormalizedCategory,
  NormalizedCategoryTree,
  RawCategoryEntry,
  RawCategoryStore
} from "../domain/schemas/index.js"

const slash = "/"

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, "")

const makeFullUrlPath = (fullUrlPath: string): string => `${slash}${trimSlashes(fullUrlPath)}`

/**
 * Resolves one entry and its children. `visited` stops a store whose children
 * point back up the tree from recursing forever: the page is not a source the
 * SDK controls, and a cycle there must cost one skipped branch, not the process.
 */
const normalizeEntry = (
  store: RawCategoryStore,
  entry: RawCategoryEntry,
  visited: ReadonlySet<string>
): NormalizedCategory => {
  const seen = new Set(visited).add(entry.id)

  return {
    categoryId: entry.id,
    children: normalizeIds(store, entry.children, seen),
    fullUrlPath: makeFullUrlPath(entry.fullURLPath),
    name: entry.name,
    retailerCategoryId: entry.retailerId
  }
}

// an ID the store does not hold names no category, so it contributes none
const normalizeIds = (
  store: RawCategoryStore,
  ids: ReadonlyArray<string>,
  visited: ReadonlySet<string>
): NormalizedCategoryTree =>
  ids.flatMap((id) => {
    const entry = store.categories[id]

    return entry === undefined || visited.has(id) ? [] : [normalizeEntry(store, entry, visited)]
  })

export const normalizeCategoryStore = (store: RawCategoryStore): NormalizedCategoryTree =>
  normalizeIds(store, store.root, new Set())

export const getInitialStateCategories = (initialState: InitialState): NormalizedCategoryTree =>
  initialState.data.categories === undefined ? [] : normalizeCategoryStore(initialState.data.categories)
