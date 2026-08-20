import type { VoilaTransportRequest, VoilaTransportResponse } from "@firfi/voila-sdk"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { makeStubEnvironment, runOperation } from "./helpers/operations.js"
import { makeAuthGuidance } from "../src/auth-guidance.js"

const cartItems = { items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }] }
const freshToken = "fresh-csrf-token"

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`../../voila-sdk/test/fixtures/${name}`, import.meta.url), "utf8")

const homepageBody = (token: string, isLoggedIn = true): string =>
  `<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
    session: {
      csrf: { token },
      isLoggedIn,
      metadata: { assetVersion: "fresh-asset-version", pageViewId: "fresh-page-view-id", regionId: "region-id" }
    }
  })};</script></body></html>`

const isHomepage = (request: VoilaTransportRequest): boolean => request.url.pathname === "/"

const ok = (body: string): Effect.Effect<VoilaTransportResponse> => Effect.succeed({ body, headers: {}, status: 200 })

const status = (code: number): Effect.Effect<VoilaTransportResponse> =>
  Effect.succeed({ body: "", headers: {}, status: code })

describe("CSRF refresh retry", () => {
  it("refreshes the token and retries a write Voila answered with a 403", async () => {
    const cartApply = await fixture("cart-apply-success.json")
    const tokens: Array<string | undefined> = []
    let writes = 0

    const fake = makeStubEnvironment((request) => {
      if (isHomepage(request)) {
        return ok(homepageBody(freshToken, false))
      }

      tokens.push(request.headers["X-CSRF-TOKEN"])
      writes += 1

      return writes === 1 ? status(403) : ok(cartApply)
    })

    const result = await runOperation("voila_add_cart_items", cartItems, fake.env)

    expect(result.ok).toBe(true)
    expect(tokens).toEqual(["csrf-token", freshToken])
    expect(fake.saved()?.session.csrf.token).toBe(freshToken)
  })

  it("reports the original rejection when the homepage hands back the same token", async () => {
    let writes = 0

    const fake = makeStubEnvironment((request) => {
      if (isHomepage(request)) {
        return ok(homepageBody("csrf-token"))
      }

      writes += 1

      return status(403)
    })

    const result = await runOperation("voila_add_cart_items", cartItems, fake.env)

    expect(result.ok).toBe(false)
    expect(writes).toBe(1)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaUnauthorizedSession")
      expect(result.error.status).toBe(403)
    }
  })

  it("reports the original rejection when the refresh itself fails", async () => {
    const fake = makeStubEnvironment((request) => (isHomepage(request) ? status(503) : status(401)))

    const result = await runOperation("voila_add_cart_items", cartItems, fake.env)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaUnauthorizedSession")
      expect(result.error.status).toBe(401)
    }
  })

  it("returns login guidance without retrying a write when the homepage reports logout", async () => {
    let writes = 0
    const fake = makeStubEnvironment(
      (request) => {
        if (isHomepage(request)) {
          return ok(homepageBody(freshToken, false))
        }

        writes += 1
        return status(403)
      },
      { sessionKind: "authenticated" }
    )

    const result = await runOperation("voila_add_cart_items", cartItems, {
      ...fake.env,
      authGuidance: makeAuthGuidance()
    })

    expect(result.ok).toBe(false)
    expect(writes).toBe(1)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaUnauthorizedSession")
      expect(result.error.authGuidance).toBeDefined()
    }
  })

  it("leaves a failure that is not an authorization failure alone", async () => {
    let requests = 0

    const fake = makeStubEnvironment(() => {
      requests += 1

      return status(400)
    })

    const result = await runOperation("voila_add_cart_items", cartItems, fake.env)

    expect(result.ok).toBe(false)
    expect(requests).toBe(1)

    if (!result.ok) {
      expect(result.error._tag).toBe("VoilaNon2xxResponse")
    }
  })

  it("does not refresh anything when the first attempt succeeds", async () => {
    const cartApply = await fixture("cart-apply-success.json")
    const paths: Array<string> = []

    const fake = makeStubEnvironment((request) => {
      paths.push(request.url.pathname)

      return ok(cartApply)
    })

    const result = await runOperation("voila_add_cart_items", cartItems, fake.env)

    expect(result.ok).toBe(true)
    expect(paths).toEqual(["/api/cart/v1/carts/active/apply-quantity"])
  })
})
