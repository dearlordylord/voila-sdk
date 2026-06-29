import { readFileSync } from "node:fs"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import { extractInitialState } from "../../src/voila/initial-state.js"

const fixtureHtml = readFileSync(new URL("../fixtures/voila-homepage.html", import.meta.url), "utf8")

const stateWithEscapedStringContent = {
  csrf: {
    token: "sanitized-csrf-token"
  },
  data: {
    basket: {
      basketId: "sanitized-basket-id",
      itemGroups: [],
      regionId: "sanitized-region-id",
      totals: {
        itemPriceAfterPromos: {
          amount: "0.00",
          currency: "CAD"
        },
        itemsRetailPrice: {
          amount: "0.00",
          currency: "CAD"
        },
        savingsPrice: {
          amount: "0.00",
          currency: "CAD"
        },
        taxation: "TAX_EXCLUDED"
      }
    }
  },
  session: {
    metadata: {
      assetVersion: "asset with \"quote\" and \\ path plus { nested } markers",
      clientRouteId: "sanitized-client-route-id",
      pageViewId: "sanitized-page-view-id",
      regionId: "sanitized-region-id"
    }
  }
}

const fixtureWithEscapedStringContent = `<script>window.__INITIAL_STATE__ = ${
  JSON.stringify(stateWithEscapedStringContent)
};</script>`
const stateWithEscapedStringContentJson = JSON.stringify(stateWithEscapedStringContent)
const markerOutsideScriptHtml =
  `<html><body><main>window.__INITIAL_STATE__ = ${stateWithEscapedStringContentJson}</main></body></html>`
const incompleteScriptHtml =
  `<html><body><script>window.__INITIAL_STATE__ = ${stateWithEscapedStringContentJson}</body></html>`

const expectLeftTag = (html: string, tag: string): void => {
  const result = extractInitialState(html)

  expect(Either.isLeft(result)).toBe(true)

  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe(tag)
  }
}

describe("extractInitialState", () => {
  it("extracts and decodes the homepage initial state", () => {
    const result = extractInitialState(fixtureHtml)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.csrf.token).toBe("sanitized-csrf-token")
      expect(result.right.data.basket.basketId).toBe("sanitized-basket-id")
      expect(result.right.session.metadata.pageViewId).toBe("sanitized-page-view-id")
    }
  })

  it("ignores semicolons and braces inside escaped JSON strings", () => {
    const result = extractInitialState(fixtureWithEscapedStringContent)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.session.metadata.assetVersion).toBe(
        "asset with \"quote\" and \\ path plus { nested } markers"
      )
    }
  })

  it("returns a typed error when the initial state script is missing", () => {
    expectLeftTag("<html><body><script>window.other = {}</script></body></html>", "InitialStateScriptMissing")
  })

  it("returns a typed error when the document has no script content", () => {
    expectLeftTag("", "InitialStateScriptMissing")
  })

  it("returns a typed error when the initial state marker is outside a script tag", () => {
    expectLeftTag(markerOutsideScriptHtml, "InitialStateScriptMissing")
  })

  it("returns a typed error when the initial state script open tag is incomplete", () => {
    expectLeftTag("<script", "InitialStateScriptMissing")
  })

  it("returns a typed error when the initial state script tag is incomplete", () => {
    expectLeftTag(incompleteScriptHtml, "InitialStateScriptMissing")
  })

  it("returns a typed error when the initial state assignment is missing", () => {
    expectLeftTag("<script>window.__INITIAL_STATE__</script>", "InitialStateJsonMissing")
  })

  it("does not accept a later unrelated assignment after a marker without payload", () => {
    expectLeftTag(
      `<script>window.__INITIAL_STATE__;</script>
      <script>window.other = ${JSON.stringify(stateWithEscapedStringContent)};</script>`,
      "InitialStateJsonMissing"
    )
  })

  it("returns a typed error when the initial state object is missing", () => {
    expectLeftTag("<script>window.__INITIAL_STATE__ = ;</script>", "InitialStateJsonMissing")
  })

  it("returns a typed error when the initial state object is unterminated", () => {
    expectLeftTag("<script>window.__INITIAL_STATE__ = {\"csrf\":{\"token\":\"ok\"}</script>", "InitialStateJsonMissing")
  })

  it("returns a typed error when the initial state JSON is malformed", () => {
    expectLeftTag("<script>window.__INITIAL_STATE__ = {\"csrf\": }</script>", "InitialStateJsonMalformed")
  })

  it("returns a typed error when the initial state schema does not match", () => {
    expectLeftTag(
      "<script>window.__INITIAL_STATE__ = {\"csrf\":{\"token\":\"ok\"}}</script>",
      "InitialStateSchemaMismatch"
    )
  })
})
