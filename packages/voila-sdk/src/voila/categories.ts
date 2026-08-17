import type {
  InitialState,
  NormalizedCategory,
  NormalizedCategoryTree,
  RawCategories,
  RawCategory,
  RawCategoryEntry,
  RawCategoryStore
} from "../domain/schemas/index.js"

const slash = "/"

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, "")

const makeNestedFullUrlPath = (parentPath: string | undefined, urlPath: string): string => {
  const normalizedPath = trimSlashes(urlPath)

  if (parentPath === undefined || urlPath.startsWith(slash)) {
    return `${slash}${normalizedPath}`
  }

  return `${slash}${[trimSlashes(parentPath), normalizedPath].filter(Boolean).join(slash)}`
}

const normalizeCategory = (category: RawCategory, parentPath: string | undefined): NormalizedCategory => {
  const fullUrlPath = makeNestedFullUrlPath(parentPath, category.urlPath)

  return {
    categoryId: category.categoryId,
    children: (category.categories ?? []).map((child) => normalizeCategory(child, fullUrlPath)),
    fullUrlPath,
    name: category.name,
    retailerCategoryId: category.retailerCategoryId
  }
}

/** Resolves the nested shape, where a child's path extends its parent's. */
export const normalizeCategoryTree = (categories: ReadonlyArray<RawCategory>): NormalizedCategoryTree =>
  categories.map((category) => normalizeCategory(category, undefined))

/**
 * Resolves one store entry and its children. `visited` stops a store whose
 * children point back up the tree from recursing forever: the page is not a
 * source the SDK controls, and a cycle there must cost one skipped branch, not
 * the process.
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
    fullUrlPath: `${slash}${trimSlashes(entry.fullURLPath)}`,
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

/** Resolves the store shape, where entries are keyed by ID and children name IDs. */
export const normalizeCategoryStore = (store: RawCategoryStore): NormalizedCategoryTree =>
  normalizeIds(store, store.root, new Set())

/**
 * Resolves whichever shape the page served. A caller wants the category tree,
 * not the news that Voila serves two of them.
 */
export const normalizeRawCategories = (categories: RawCategories): NormalizedCategoryTree =>
  "root" in categories ? normalizeCategoryStore(categories) : normalizeCategoryTree(categories)

export const getInitialStateCategories = (initialState: InitialState): NormalizedCategoryTree =>
  initialState.data.categories === undefined ? [] : normalizeRawCategories(initialState.data.categories)
