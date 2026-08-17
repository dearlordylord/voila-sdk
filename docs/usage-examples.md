# Usage Examples

All examples import from the package entrypoint. They use placeholders for local paths and browser wiring; do not put cookies, CSRF tokens, account identifiers, addresses, payment data, or credentials in source files.

Every operation that talks to Voila is an `Effect` requiring the `VoilaTransport` service. A program provides one transport layer and every operation inside it uses that transport. Failures stay in the typed error channel; `Effect.either` turns one into an `Either` where a caller would rather branch than short-circuit.

## Shared Transport

```ts
import { Effect, Layer } from "effect"
import { connectionFailure, responseReadFailure, VoilaTransport } from "@firfi/voila-sdk"

const responseHeadersFromFetch = (headers: Headers) => {
  const setCookie = headers.getSetCookie()
  const entries = Object.fromEntries(headers.entries())

  return setCookie.length === 0 ? entries : { ...entries, "set-cookie": setCookie }
}

export const fetchTransportLayer = Layer.succeed(VoilaTransport, {
  request: (request) =>
    Effect.flatMap(
      Effect.tryPromise({
        catch: connectionFailure,
        try: () =>
          fetch(request.url, {
            ...(request.body === undefined ? {} : { body: request.body }),
            headers: request.headers,
            method: request.method,
            redirect: "manual"
          })
      }),
      (response) =>
        Effect.map(
          Effect.tryPromise({ catch: responseReadFailure, try: () => response.text() }),
          (body) => ({ body, headers: responseHeadersFromFetch(response.headers), status: response.status })
        )
    )
})
```

A transport reports three failures, all free of request material: `VoilaConnectionFailure`, `VoilaResponseReadFailure`, and `VoilaRequestDeadlineExceeded`.

`@firfi/voila-mcp` exports `nodeVoilaTransportLayer`, the transport the MCP server and the CLI run: `@effect/platform`'s `HttpClient`, a stable browser identity, and a Clock-driven deadline that cancels the underlying request.

## Guest Search

```ts
import { Effect } from "effect"
import { bootstrapGuestSession, searchProducts } from "@firfi/voila-sdk"
import { fetchTransportLayer } from "./transport.js"

const program = Effect.gen(function*() {
  const bootstrap = yield* bootstrapGuestSession()
  const search = yield* searchProducts(bootstrap.session, { pageSize: 12, query: "milk" })

  return search.value.products.map((product) => product.name)
})

console.log(await Effect.runPromise(Effect.provide(program, fetchTransportLayer)))
```

## Guest Cart Add/Remove Cleanup

`Effect.ensuring` runs the cleanup on every exit of the effect it wraps, including a failed or interrupted one — a cart left dirty because the read after the add failed is the thing this example exists to avoid.

```ts
import { Effect } from "effect"
import { addCartItems, bootstrapGuestSession, getCart, removeCartItems, searchProducts } from "@firfi/voila-sdk"
import { fetchTransportLayer } from "./transport.js"

const program = Effect.gen(function*() {
  const bootstrap = yield* bootstrapGuestSession()
  const search = yield* searchProducts(bootstrap.session, { pageSize: 12, query: "bananas" })
  const product = search.value.products.find((item) => item.available === true)

  if (product === undefined) {
    return yield* Effect.fail({ _tag: "NoAvailableProduct" })
  }

  const items = [{ productId: product.productId, quantity: 1 }]
  const added = yield* addCartItems(bootstrap.session, items)

  return yield* Effect.ensuring(
    Effect.map(getCart(added.session), (cart) => cart.value.totals),
    Effect.ignore(removeCartItems(added.session, items))
  )
})

console.log(await Effect.runPromise(Effect.provide(program, fetchTransportLayer)))
```

## Interactive Login

`loginWithBrowser` drives a caller-owned browser and needs no transport.

```ts
import { Effect, Either } from "effect"
import { createInteractiveBrowserLoginPort, loginWithBrowser } from "@firfi/voila-sdk"

const browserPort = createInteractiveBrowserLoginPort({
  openPage: async () => ({
    close: async () => {
      // Close the caller-owned browser context.
    },
    openLogin: async (request) => {
      // Navigate an interactive browser page to request.loginUrl.
    },
    readAccountSummary: async () => undefined,
    readAuthenticated: async () => {
      // Return true only after the page proves the account is logged in.
      return false
    },
    readCookies: async (_url) => [],
    readInitialState: async () => undefined,
    waitForLoginCompletion: async () => Either.right(undefined)
  })
})

const login = await Effect.runPromise(loginWithBrowser(browserPort, { timeoutMs: 120000 }))
```

See [browser-login.md](./browser-login.md) for a Playwright-shaped adapter outline. The SDK never accepts a password.

## Session Load

Storage in the SDK is read-only. Capture a session with `npx -y @firfi/voila-cli auth login --session <absolute path>`. A storage adapter owns its own read and names the failure in the SDK's vocabulary rather than leaking a platform error.

```ts
import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import { loadSdkSessionSnapshot, sessionStorageReadFailure, type SessionStoragePort } from "@firfi/voila-sdk"

const sessionFile = "/absolute/path/outside/repository/voila-sdk-session.json"

export const storage: SessionStoragePort = {
  read: () => Effect.tryPromise({ catch: sessionStorageReadFailure, try: () => readFile(sessionFile, "utf8") })
}

const snapshot = await Effect.runPromise(loadSdkSessionSnapshot(storage))
```

The stored snapshot is sensitive. Keep it outside the repository or under an ignored local-only directory.

## Authenticated Cart Read

```ts
import { Effect } from "effect"
import { checkSessionHealth, getCart, loadSdkSessionSnapshot } from "@firfi/voila-sdk"
import { storage } from "./storage.js"
import { fetchTransportLayer } from "./transport.js"

const program = Effect.gen(function*() {
  const snapshot = yield* loadSdkSessionSnapshot(storage)

  if (snapshot.kind !== "authenticated") {
    return yield* Effect.fail({ _tag: "AuthenticatedSessionRequired" })
  }

  const health = yield* checkSessionHealth(snapshot)

  if (health.status !== "active") {
    return yield* Effect.fail({ _tag: "SessionNotActive", status: health.status })
  }

  const cart = yield* getCart(health.session.session)

  return cart.value.totals
})

console.log(await Effect.runPromise(Effect.provide(program, fetchTransportLayer)))
```

## Checkout Review

```ts
import { Effect } from "effect"
import { decideCheckoutReadiness, getCheckoutSummary, loadSdkSessionSnapshot } from "@firfi/voila-sdk"
import { storage } from "./storage.js"
import { fetchTransportLayer } from "./transport.js"

const program = Effect.gen(function*() {
  const snapshot = yield* loadSdkSessionSnapshot(storage)
  const summary = yield* getCheckoutSummary(snapshot.session, {})
  const readiness = decideCheckoutReadiness(summary.value)

  switch (readiness.status) {
    case "blocked":
      return readiness.checkoutRestrictions
    case "needs-review":
      return readiness.warnings
    case "ready-for-manual-checkout":
      return summary.value.totals
  }
})

console.log(await Effect.runPromise(Effect.provide(program, fetchTransportLayer)))
```

Checkout review is read-only. The SDK does not place orders; use the latest summary only to decide what a human should review in Voila.
