import type { SessionMetadata } from "../domain/schemas/index.js"

export type ResponseHeaders = Readonly<Record<string, ReadonlyArray<string> | string | undefined>>

export const makeVoilaHeaders = (
  metadata: SessionMetadata,
  csrfToken: string
): Readonly<Record<string, string>> => ({
  "X-CSRF-TOKEN": csrfToken,
  "client-route-id": metadata.clientRouteId,
  "content-type": "application/json",
  "ecom-request-source": "web",
  "ecom-request-source-version": metadata.assetVersion,
  "page-view-id": metadata.pageViewId
})

export const getHeaderValues = (
  headers: ResponseHeaders,
  headerName: string
): ReadonlyArray<string> => {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === headerName)

  if (found === undefined) {
    return []
  }

  const value = found[1]

  if (value === undefined) {
    return []
  }

  return typeof value === "string" ? [value] : value
}
