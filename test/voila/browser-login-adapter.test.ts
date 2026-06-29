import { Either } from "effect"
import { describe, expect, it } from "vitest"

import {
  type CookieJarPort,
  createInteractiveBrowserLoginPort,
  type InteractiveBrowserLoginPage,
  loginWithBrowser,
  toughCookieJarPort,
  VOILA_BASE_URL
} from "../../src/index.js"

const voilaUrl = "https://voila.ca/"
const secretCookieValue = "secret-cookie-value"
const secretCsrfToken = "secret-csrf-token"
const secretFailurePayload = "secret-browser-failure"
const secretEmailHint = "secret@example.test"

const initialState = {
  csrf: {
    token: secretCsrfToken
  },
  data: {
    basket: {
      basketId: "basket-id",
      regionId: "region-id",
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
      assetVersion: "asset-version",
      clientRouteId: "client-route-id",
      pageViewId: "page-view-id",
      regionId: "region-id"
    }
  }
}

const browserCookies = [{
  domain: "voila.ca",
  httpOnly: true,
  name: "voila-session",
  path: "/",
  secure: true,
  value: secretCookieValue
}, {
  domain: "voila.ca",
  expires: 1_893_456_000,
  httpOnly: false,
  name: "voila-preferences",
  path: "/",
  sameSite: "Lax",
  secure: false,
  value: "prefs"
}]

const makePage = (
  options: {
    readonly accountAbsent?: boolean
    readonly accountPayload?: unknown
    readonly authenticatedPayload?: unknown
    readonly closeThrows?: boolean
    readonly cookiesPayload?: unknown
    readonly initialStatePayload?: unknown
    readonly openThrows?: boolean
    readonly readAccountThrows?: boolean
    readonly readAuthenticatedThrows?: boolean
    readonly readCookiesThrows?: boolean
    readonly readInitialStateThrows?: boolean
    readonly waitResult?: unknown
    readonly waitResultProvided?: boolean
    readonly waitThrows?: boolean
  } = {}
): {
  readonly calls: ReadonlyArray<string>
  readonly page: InteractiveBrowserLoginPage
} => {
  const calls: Array<string> = []

  return {
    calls,
    page: {
      close: async () => {
        calls.push("close")

        if (options.closeThrows === true) {
          throw new Error(secretFailurePayload)
        }
      },
      openLogin: async (request) => {
        calls.push(`open:${request.loginUrl}`)

        if (options.openThrows === true) {
          throw new Error(secretFailurePayload)
        }
      },
      readAccountSummary: async () => {
        calls.push("readAccountSummary")

        if (options.readAccountThrows === true) {
          throw new Error(secretFailurePayload)
        }

        return options.accountAbsent === true ? undefined : options.accountPayload ?? {
          emailHint: secretEmailHint
        }
      },
      readAuthenticated: async () => {
        calls.push("readAuthenticated")

        if (options.readAuthenticatedThrows === true) {
          throw new Error(secretFailurePayload)
        }

        return options.authenticatedPayload ?? true
      },
      readCookies: async (url) => {
        calls.push(`readCookies:${url}`)

        if (options.readCookiesThrows === true) {
          throw new Error(secretFailurePayload)
        }

        return options.cookiesPayload ?? browserCookies
      },
      readInitialState: async () => {
        calls.push("readInitialState")

        if (options.readInitialStateThrows === true) {
          throw new Error(secretFailurePayload)
        }

        return options.initialStatePayload ?? initialState
      },
      waitForLoginCompletion: async () => {
        calls.push("waitForLoginCompletion")

        if (options.waitThrows === true) {
          throw new Error(secretFailurePayload)
        }

        return options.waitResultProvided === true ? options.waitResult : Either.right(undefined)
      }
    }
  }
}

const getSessionCookieHeader = (cookieJar: Parameters<typeof toughCookieJarPort.deserialize>[0]): string => {
  const jar = toughCookieJarPort.deserialize(cookieJar)

  if (Either.isLeft(jar)) {
    throw new Error("Expected cookie jar to deserialize")
  }

  return jar.right.getCookieStringSync(voilaUrl)
}

const failingSerializeCookieJarPort: CookieJarPort = {
  create: toughCookieJarPort.create,
  deserialize: toughCookieJarPort.deserialize,
  serialize: () =>
    Either.left({
      _tag: "CookieJarSerializationFailed",
      message: secretFailurePayload
    })
}

describe("interactive browser login adapter", () => {
  it("opens an interactive page and captures an authenticated session", async () => {
    const fake = makePage()
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port, { timeoutMs: 120_000 })

    expect(Either.isRight(result)).toBe(true)
    expect(fake.calls).toEqual([
      "open:https://voila.ca/",
      "waitForLoginCompletion",
      "readInitialState",
      `readCookies:${VOILA_BASE_URL}`,
      "readAuthenticated",
      "readAccountSummary",
      "close"
    ])

    if (Either.isRight(result)) {
      expect(result.right.session.kind).toBe("authenticated")
      expect(result.right.session.account?.emailHint).toBe(secretEmailHint)
      expect(getSessionCookieHeader(result.right.session.session.cookieJar)).toContain(
        `voila-session=${secretCookieValue}`
      )
    }
  })

  it("returns a typed timeout and closes the browser page", async () => {
    const fake = makePage({
      waitResult: Either.left({
        _tag: "BrowserLoginTimedOut",
        message: secretFailurePayload
      }),
      waitResultProvided: true
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.calls).toEqual([
      "open:https://voila.ca/",
      "waitForLoginCompletion",
      "close"
    ])

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginTimedOut")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it("returns a typed cancellation and closes the browser page", async () => {
    const fake = makePage({
      waitResult: Either.left({
        _tag: "BrowserLoginUserCancelled",
        message: secretFailurePayload
      }),
      waitResultProvided: true
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.calls).toEqual([
      "open:https://voila.ca/",
      "waitForLoginCompletion",
      "close"
    ])

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginUserCancelled")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it("captures an authenticated session without optional account details", async () => {
    const fake = makePage({
      accountAbsent: true
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isRight(result)).toBe(true)

    if (Either.isRight(result)) {
      expect(result.right.session.account).toBeUndefined()
    }
  })

  it("redacts malformed browser captures into typed adapter failures", async () => {
    const fake = makePage({
      initialStatePayload: {
        csrf: {
          token: secretCsrfToken
        }
      }
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.calls).toContain("close")

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretCsrfToken)
    }
  })

  it("returns not-authenticated when browser evidence is false", async () => {
    const fake = makePage({
      authenticatedPayload: false
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginNotAuthenticated")
    }
  })

  it.each([undefined, null, secretFailurePayload])(
    "redacts malformed wait result %s into typed adapter failures",
    async (waitResult) => {
      const fake = makePage({
        waitResult,
        waitResultProvided: true
      })
      const port = createInteractiveBrowserLoginPort({
        openPage: async () => fake.page
      })

      const result = await loginWithBrowser(port)

      expect(Either.isLeft(result)).toBe(true)
      expect(fake.calls).toEqual([
        "open:https://voila.ca/",
        "waitForLoginCompletion",
        "close"
      ])

      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
        expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
      }
    }
  )

  it("redacts unknown wait failures into typed adapter failures", async () => {
    const fake = makePage({
      waitResult: Either.left({
        _tag: "UnexpectedWaitFailure",
        message: secretFailurePayload
      }),
      waitResultProvided: true
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it.each([
    { option: "openThrows", expectedCalls: ["open:https://voila.ca/", "close"] },
    { option: "waitThrows", expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "close"] },
    {
      option: "readInitialStateThrows",
      expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "readInitialState", "close"]
    },
    {
      option: "readCookiesThrows",
      expectedCalls: [
        "open:https://voila.ca/",
        "waitForLoginCompletion",
        "readInitialState",
        "readCookies:https://voila.ca",
        "close"
      ]
    },
    {
      option: "readAuthenticatedThrows",
      expectedCalls: [
        "open:https://voila.ca/",
        "waitForLoginCompletion",
        "readInitialState",
        "readCookies:https://voila.ca",
        "readAuthenticated",
        "close"
      ]
    },
    {
      option: "readAccountThrows",
      expectedCalls: [
        "open:https://voila.ca/",
        "waitForLoginCompletion",
        "readInitialState",
        "readCookies:https://voila.ca",
        "readAuthenticated",
        "readAccountSummary",
        "close"
      ]
    },
    {
      option: "closeThrows",
      expectedCalls: [
        "open:https://voila.ca/",
        "waitForLoginCompletion",
        "readInitialState",
        "readCookies:https://voila.ca",
        "readAuthenticated",
        "readAccountSummary",
        "close"
      ]
    }
  ])("redacts thrown browser operation $option into typed adapter failures", async ({ expectedCalls, option }) => {
    const fake = makePage({
      [option]: true
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.calls).toEqual(expectedCalls)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it.each([
    { cookiesPayload: secretFailurePayload, name: "malformed cookies" },
    { cookiesPayload: [{ ...browserCookies[0], name: "bad;name" }], name: "invalid cookie name" }
  ])("redacts $name into typed adapter failures", async ({ cookiesPayload }) => {
    const fake = makePage({ cookiesPayload })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it.each([
    {
      expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "close"],
      name: "thrown wait",
      options: {
        closeThrows: true,
        waitThrows: true
      }
    },
    {
      expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "close"],
      name: "malformed wait result",
      options: {
        closeThrows: true,
        waitResult: undefined,
        waitResultProvided: true
      }
    },
    {
      expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "close"],
      name: "wait left",
      options: {
        closeThrows: true,
        waitResult: Either.left({
          _tag: "BrowserLoginTimedOut",
          message: secretFailurePayload
        }),
        waitResultProvided: true
      }
    },
    {
      expectedCalls: ["open:https://voila.ca/", "waitForLoginCompletion", "readInitialState", "close"],
      name: "thrown read",
      options: {
        closeThrows: true,
        readInitialStateThrows: true
      }
    }
  ])("redacts close failure after $name into typed adapter failures", async ({ expectedCalls, options }) => {
    const fake = makePage(options)
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)
    expect(fake.calls).toEqual(expectedCalls)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it.each([
    { accountPayload: { emailHint: 1 }, name: "malformed account" },
    { authenticatedPayload: secretFailurePayload, name: "malformed authentication evidence" }
  ])("redacts $name into typed adapter failures", async ({ accountPayload, authenticatedPayload }) => {
    const fake = makePage({
      accountPayload,
      authenticatedPayload
    })
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    })

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })

  it("redacts cookie jar persistence failures into typed adapter failures", async () => {
    const fake = makePage()
    const port = createInteractiveBrowserLoginPort({
      openPage: async () => fake.page
    }, failingSerializeCookieJarPort)

    const result = await loginWithBrowser(port)

    expect(Either.isLeft(result)).toBe(true)

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BrowserLoginAdapterFailure")
      expect(JSON.stringify(result.left)).not.toContain(secretFailurePayload)
    }
  })
})
