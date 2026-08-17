import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import type {
  CookieJarPort,
  GuestBootstrapError,
  GuestBootstrapResult,
  VoilaTransportResponse
} from "../../src/index.js"
import { bootstrapGuestSession, toughCookieJarPort, VOILA_BASE_URL } from "../../src/index.js"
import {
  connectionFailureTransport,
  deadlineExceededTransport,
  respondingTransport,
  runWith
} from "../helpers/transport.js"

const fixtureHtml = readFileSync(new URL("../fixtures/voila-homepage.html", import.meta.url), "utf8")
const sessionCookie = "guest-session=fixture; Path=/; Secure"
const secretFailurePayload = "guest-session=secret"

const minimalInitialState = {
  data: {
    basket: {
      basketId: "fixture-basket-id",
      regionId: "fixture-region-id",
      totals: {
        itemPriceAfterPromos: { amount: "0.00", currency: "CAD" },
        itemsRetailPrice: { amount: "0.00", currency: "CAD" },
        savingsPrice: { amount: "0.00", currency: "CAD" },
        taxation: "TAX_EXCLUDED"
      }
    }
  },
  session: {
    csrf: { token: "fixture-csrf-token" },
    metadata: {
      assetVersion: "fixture-asset-version",
      clientRouteId: "fixture-client-route-id",
      pageViewId: "fixture-page-view-id",
      regionId: "fixture-region-id"
    }
  }
}

// the token lives with the rest of what the page says about the session, so a
// test that removes it removes it from there
const withCsrf = (csrf: unknown): unknown => ({
  ...minimalInitialState,
  session: { ...minimalInitialState.session, csrf }
})

const initialStateWithItems = {
  ...minimalInitialState,
  data: {
    basket: {
      ...minimalInitialState.data.basket,
      itemGroups: [
        {
          items: [
            { productId: "first-product", quantity: 2 },
            { productId: "second-product", quantity: 3 }
          ]
        }
      ]
    }
  }
}

const htmlFromInitialState = (initialState: unknown): string =>
  `<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify(initialState)};</script></body></html>`

const makeHomepageResponse = (
  body: string,
  headers: VoilaTransportResponse["headers"] = { "set-cookie": sessionCookie },
  status: number = 200
): VoilaTransportResponse => ({ body, headers, status })

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () => Either.left({ _tag: "CookieJarSerializationFailed", message: secretFailurePayload })
}

const getSessionCookies = (result: Either.Either<GuestBootstrapResult, GuestBootstrapError>): string => {
  if (Either.isLeft(result)) {
    throw new Error("Expected bootstrap to succeed")
  }

  const jar = toughCookieJarPort.deserialize(result.right.session.cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected result cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(VOILA_BASE_URL)
}

describe("bootstrapGuestSession", () => {
  it("creates a guest session from the Voila homepage fixture", async () => {
    const fake = respondingTransport(makeHomepageResponse(fixtureHtml))
    const result = await runWith(bootstrapGuestSession(), fake)
    const [request] = fake.requests

    expect(Either.isRight(result)).toBe(true)
    expect(request?.method).toBe("GET")
    expect(request?.url.href).toBe(`${VOILA_BASE_URL}/`)

    if (Either.isRight(result)) {
      expect(result.right.csrf.token).toBe("sanitized-csrf-token")
      expect(result.right.metadata.pageViewId).toBe("sanitized-page-view-id")
      expect(result.right.regionId).toBe("sanitized-region-id")
      expect(result.right.categories[0]?.categoryId).toBe("sanitized-category-produce")
      expect(result.right.categories[0]?.children[0]?.fullUrlPath).toBe("/aisles/fruits-vegetables/fresh-fruit")
      expect(result.right.cart.basketId).toBe("sanitized-basket-id")
      expect(result.right.cart.itemCount).toBe(0)
      expect(getSessionCookies(result)).toContain("guest-session=fixture")
    }
  })

  it("summarizes baskets that omit item groups", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(htmlFromInitialState(minimalInitialState)))
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.cart.itemCount).toBe(0)
      expect(result.right.cart.regionId).toBe("fixture-region-id")
    }
  })

  it("summarizes item counts across cart item groups", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(htmlFromInitialState(initialStateWithItems)))
    )

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.cart.itemCount).toBe(5)
    }
  })

  it("returns a typed error when homepage cookies are missing", async () => {
    const result = await runWith(bootstrapGuestSession(), respondingTransport(makeHomepageResponse(fixtureHtml, {})))

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapMissingCookies")
    }
  })

  it("returns a typed error when homepage cookies are malformed", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(fixtureHtml, { "set-cookie": "bad cookie value" }))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapCookiePersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain("bad cookie value")
    }
  })

  it("returns a typed redacted error when homepage cookie serialization fails", async () => {
    const result = await runWith(
      bootstrapGuestSession(failingSerializeCookieJarPort),
      respondingTransport(makeHomepageResponse(fixtureHtml))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapCookiePersistenceFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it("returns a typed error when CSRF is missing from initial state", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(htmlFromInitialState(withCsrf({ token: " " }))))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapMissingCsrf")
    }
  })

  it("returns a typed error when the CSRF object is absent from initial state", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(htmlFromInitialState(withCsrf(undefined))))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapMissingCsrf")
    }
  })

  it("returns a typed error when the CSRF token is absent from initial state", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse(htmlFromInitialState(withCsrf({}))))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapMissingCsrf")
    }
  })

  it("returns a typed error when initial state is malformed", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse('<script>window.__INITIAL_STATE__ = {"csrf":}</script>'))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("GuestBootstrapInitialStateMalformed")
    }
  })

  it("surfaces the transport's own failure when the homepage cannot be reached", async () => {
    const result = await runWith(bootstrapGuestSession(), connectionFailureTransport())

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaConnectionFailure")
    }
  })

  it("distinguishes an abandoned deadline from a refused connection", async () => {
    const result = await runWith(bootstrapGuestSession(), deadlineExceededTransport())

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("VoilaRequestDeadlineExceeded")
      expect(JSON.stringify(result.left)).not.toContain("voila.ca")
    }
  })

  it("returns a typed error for non-2xx homepage responses", async () => {
    const result = await runWith(
      bootstrapGuestSession(),
      respondingTransport(makeHomepageResponse("not used", { "set-cookie": sessionCookie }, 500))
    )

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result) && result.left._tag === "GuestBootstrapNon2xxResponse") {
      expect(result.left._tag).toBe("GuestBootstrapNon2xxResponse")
      expect(result.left.status).toBe(500)
    }
  })
})
