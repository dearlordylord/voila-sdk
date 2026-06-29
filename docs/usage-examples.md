# Usage Examples

All examples import from the package entrypoint. They use placeholders for local paths and browser wiring; do not put cookies, CSRF tokens, account identifiers, addresses, payment data, or credentials in source files.

## Shared Transport

```ts
import { Either } from "effect"
import type { VoilaTransport } from "@firfi/voila-sdk"

const responseHeadersFromFetch = (headers: Headers) => {
  const setCookie = headers.getSetCookie()
  const entries = Object.fromEntries(headers.entries())

  return setCookie.length === 0
    ? entries
    : {
      ...entries,
      "set-cookie": setCookie
    }
}

export const fetchTransport: VoilaTransport = {
  request: async (request) => {
    const response = await fetch(request.url, {
      body: request.body,
      headers: request.headers,
      method: request.method,
      redirect: "manual"
    })

    return Either.right({
      body: await response.text(),
      headers: responseHeadersFromFetch(response.headers),
      status: response.status
    })
  }
}
```

## Guest Search

```ts
import { Either } from "effect"
import { bootstrapGuestSession, searchProducts } from "@firfi/voila-sdk"
import { fetchTransport } from "./transport.js"

const bootstrap = await bootstrapGuestSession(fetchTransport)

if (Either.isLeft(bootstrap)) {
  throw new Error(bootstrap.left._tag)
}

const search = await searchProducts(
  bootstrap.right.session,
  {
    pageSize: 12,
    query: "milk"
  },
  fetchTransport
)

if (Either.isLeft(search)) {
  throw new Error(search.left._tag)
}

console.log(search.right.value.products.map((product) => product.name))
```

## Guest Cart Add/Remove Cleanup

```ts
import { Either } from "effect"
import { addCartItems, bootstrapGuestSession, removeCartItems, searchProducts } from "@firfi/voila-sdk"
import { fetchTransport } from "./transport.js"

const bootstrap = await bootstrapGuestSession(fetchTransport)

if (Either.isLeft(bootstrap)) {
  throw new Error(bootstrap.left._tag)
}

const search = await searchProducts(bootstrap.right.session, { pageSize: 12, query: "bananas" }, fetchTransport)

if (Either.isLeft(search)) {
  throw new Error(search.left._tag)
}

const product = search.right.value.products.find((item) => item.available === true)

if (product === undefined) {
  throw new Error("No available product found")
}

const add = await addCartItems(bootstrap.right.session, [{ productId: product.productId, quantity: 1 }], fetchTransport)

if (Either.isLeft(add)) {
  throw new Error(add.left._tag)
}

try {
  console.log(add.right.value.totals)
} finally {
  const cleanup = await removeCartItems(
    add.right.session,
    [{ productId: product.productId, quantity: 1 }],
    fetchTransport
  )

  if (Either.isLeft(cleanup)) {
    throw new Error(cleanup.left._tag)
  }
}
```

## Interactive Login

```ts
import { Either } from "effect"
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

const login = await loginWithBrowser(browserPort, { timeoutMs: 120000 })

if (Either.isLeft(login)) {
  throw new Error(login.left._tag)
}
```

See [browser-login.md](./browser-login.md) for a Playwright-shaped adapter outline. The SDK never accepts a password.

## Session Save/Load

```ts
import { readFile, writeFile } from "node:fs/promises"
import { Either } from "effect"
import {
  bootstrapGuestSession,
  loadSdkSessionSnapshot,
  makeGuestSdkSessionSnapshot,
  saveSdkSessionSnapshot,
  type SessionStoragePort
} from "@firfi/voila-sdk"
import { fetchTransport } from "./transport.js"

const sessionFile = "/absolute/path/outside/repository/voila-sdk-session.json"

const storage: SessionStoragePort = {
  read: async () => readFile(sessionFile, "utf8"),
  write: async (contents) => writeFile(sessionFile, contents, { mode: 0o600 })
}

const bootstrap = await bootstrapGuestSession(fetchTransport)

if (Either.isLeft(bootstrap)) {
  throw new Error(bootstrap.left._tag)
}

const guestSnapshot = makeGuestSdkSessionSnapshot(bootstrap.right.session)

if (Either.isLeft(guestSnapshot)) {
  throw new Error(guestSnapshot.left._tag)
}

const saved = await saveSdkSessionSnapshot(storage, guestSnapshot.right)

if (Either.isLeft(saved)) {
  throw new Error(saved.left._tag)
}

const loaded = await loadSdkSessionSnapshot(storage)

if (Either.isLeft(loaded)) {
  throw new Error(loaded.left._tag)
}
```

The session file is sensitive. Keep it outside the repository or under an ignored local-only directory.

## Authenticated Cart Read

```ts
import { readFile, writeFile } from "node:fs/promises"
import { Either } from "effect"
import { checkSessionHealth, getCart, loadSdkSessionSnapshot, type SessionStoragePort } from "@firfi/voila-sdk"
import { fetchTransport } from "./transport.js"

const sessionFile = "/absolute/path/outside/repository/voila-sdk-session.json"

const storage: SessionStoragePort = {
  read: async () => readFile(sessionFile, "utf8"),
  write: async (contents) => writeFile(sessionFile, contents, { mode: 0o600 })
}

const loaded = await loadSdkSessionSnapshot(storage)

if (Either.isLeft(loaded)) {
  throw new Error(loaded.left._tag)
}

if (loaded.right.kind !== "authenticated") {
  throw new Error("authenticated-session-required")
}

const health = await checkSessionHealth(loaded.right, fetchTransport)

if (Either.isLeft(health)) {
  throw new Error(health.left._tag)
}

if (health.right.status !== "active") {
  throw new Error(health.right.status)
}

const cart = await getCart(health.right.session.session, fetchTransport)

if (Either.isLeft(cart)) {
  throw new Error(cart.left._tag)
}

console.log(cart.right.value.totals)
```

## Checkout Review

```ts
import { readFile } from "node:fs/promises"
import { Either } from "effect"
import { decideCheckoutReadiness, getCheckoutSummary, loadSdkSessionSnapshot } from "@firfi/voila-sdk"
import { fetchTransport } from "./transport.js"

const loaded = await loadSdkSessionSnapshot({
  read: async () => readFile("/absolute/path/outside/repository/voila-sdk-session.json", "utf8"),
  write: async () => undefined
})

if (Either.isLeft(loaded)) {
  throw new Error(loaded.left._tag)
}

const summary = await getCheckoutSummary(loaded.right.session, {}, fetchTransport)

if (Either.isLeft(summary)) {
  throw new Error(summary.left._tag)
}

const readiness = decideCheckoutReadiness(summary.right.value)

switch (readiness.status) {
  case "blocked":
    console.log(readiness.checkoutRestrictions)
    break
  case "needs-review":
    console.log(readiness.warnings)
    break
  case "ready-for-manual-checkout":
    console.log(summary.right.value.totals)
    break
}
```

Checkout review is read-only. The SDK does not place orders; use the latest summary only to decide what a human should review in Voila.
