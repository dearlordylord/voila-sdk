import type { InitialState, NormalizedCategory, NormalizedCategoryTree, RawCategory } from "../domain/schemas/index.js"

const slash = "/"

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, "")

const makeFullUrlPath = (parentPath: string | undefined, urlPath: string): string => {
  const normalizedPath = trimSlashes(urlPath)

  if (parentPath === undefined || urlPath.startsWith(slash)) {
    return `${slash}${normalizedPath}`
  }

  return `${slash}${[trimSlashes(parentPath), normalizedPath].filter(Boolean).join(slash)}`
}

const normalizeCategory = (
  category: RawCategory,
  parentPath: string | undefined
): NormalizedCategory => {
  const fullUrlPath = makeFullUrlPath(parentPath, category.urlPath)

  return {
    categoryId: category.categoryId,
    children: (category.categories ?? []).map((child) => normalizeCategory(child, fullUrlPath)),
    fullUrlPath,
    name: category.name,
    retailerCategoryId: category.retailerCategoryId
  }
}

export const normalizeCategoryTree = (
  categories: ReadonlyArray<RawCategory>
): NormalizedCategoryTree => categories.map((category) => normalizeCategory(category, undefined))

export const getInitialStateCategories = (
  initialState: InitialState
): NormalizedCategoryTree => normalizeCategoryTree(initialState.data.categories ?? [])
