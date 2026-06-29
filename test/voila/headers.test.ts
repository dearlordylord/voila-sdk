import { describe, expect, it } from "vitest"

import { makeVoilaHeaders } from "../../src/voila/headers.js"

describe("makeVoilaHeaders", () => {
  it("builds browser-compatible Voila API headers", () => {
    expect(makeVoilaHeaders({
      assetVersion: "2.0.0-test",
      clientRouteId: "route-id",
      pageViewId: "page-view-id",
      regionId: "region-id"
    }, "csrf-token")).toEqual({
      "X-CSRF-TOKEN": "csrf-token",
      "client-route-id": "route-id",
      "content-type": "application/json",
      "ecom-request-source": "web",
      "ecom-request-source-version": "2.0.0-test",
      "page-view-id": "page-view-id"
    })
  })
})
