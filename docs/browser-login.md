# Interactive Browser Login

Authenticated sessions must be captured through an interactive browser. The SDK does not accept a Voila password and does not replay login forms.

## Host Capture

The preferred user-facing flow is now the CLI:

```bash
PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright-voila \
voila auth login --session ~/.config/voila/session.json
```

The CLI opens a persistent Playwright profile at `~/.cache/voila/browser-profile` by default. Override it with `--profile <dir>`. Log in manually, then close the browser window to save. The command saves only after authenticated account evidence is observed and session health validates; a guest/signed-out page is rejected.

On a host with a graphical browser session, run:

```bash
pnpm auth:capture
```

The command creates a temporary Node project outside this repository, installs Playwright and the SDK runtime dependencies there, installs the Playwright Chromium browser in a host cache, and opens Voila. Log in manually. A second tab polls Voila in the same browser context and saves automatically after authenticated state is observed. The script saves the SDK session snapshot to:

```text
local-session-snapshots/voila-auth-session.json
```

That directory is ignored by git. Treat both the snapshot and `local-session-snapshots/browser-profile/` as sensitive session material.

This avoids mixing host-native browser binaries or `node_modules` with the Docker-managed workspace. The command reads the built SDK from `dist/src`; if `dist/src/index.js` is missing, run `pnpm build` inside Docker first.

After capture, a Docker container with this repo mounted at `/workspace/typescript/voila` can verify the session with:

```bash
VOILA_AUTH_SMOKE=1 \
VOILA_AUTH_SESSION_PATH=/workspace/typescript/voila/local-session-snapshots/voila-auth-session.json \
pnpm smoke:auth-readonly
```

Optional environment overrides:

- `VOILA_AUTH_SESSION_PATH`: output snapshot path.
- `VOILA_BROWSER_PROFILE_DIR`: persistent browser profile path.
- `VOILA_AUTH_CAPTURE_TIMEOUT_MS`: login timeout in milliseconds.
- `VOILA_SESSION_DIR`: directory for default snapshot/profile paths.
- `PLAYWRIGHT_BROWSERS_PATH`: host cache for Playwright browser binaries. Defaults to `~/.cache/ms-playwright-voila`.

## Custom Adapter

Use `createInteractiveBrowserLoginPort` with a small browser wrapper, then pass that port to `loginWithBrowser`.

```ts
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Either } from "effect"
import { chromium } from "playwright"
import { createInteractiveBrowserLoginPort, loginWithBrowser } from "@firfi/voila-sdk"

const profileDir = join(tmpdir(), "voila-sdk-browser-profile")
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false
})

const page = await context.newPage()

const port = createInteractiveBrowserLoginPort({
  openPage: async () => ({
    close: async () => {
      await context.close()
    },
    openLogin: async (request) => {
      await page.goto(request.loginUrl)
    },
    readAccountSummary: async () => undefined,
    readAuthenticated: async () => page.evaluate("Boolean(window.__INITIAL_STATE__?.data?.customer)"),
    readCookies: async (url) => context.cookies([url]),
    readInitialState: async () => page.evaluate("window.__INITIAL_STATE__"),
    waitForLoginCompletion: async () => {
      await page.waitForFunction("Boolean(window.__INITIAL_STATE__?.csrf?.token)")

      return Either.right(undefined)
    }
  })
})

const result = await loginWithBrowser(port, { timeoutMs: 120_000 })
```

Persistent browser profiles contain cookies and local storage. Treat `profileDir` as sensitive session data; keep it outside the repository or add the exact path to `.gitignore` before using a repo-local location.

The wrapper is responsible for deciding when login is complete and for providing a conservative `readAuthenticated` signal. Replace the example expression with a probe that proves the current Voila page is account-authenticated. If the wrapper cannot prove the user is authenticated, return `false`; the SDK will refuse to promote the session to authenticated state.

Map browser timeouts to `Either.left({ _tag: "BrowserLoginTimedOut" })` and user-initiated cancellation to `Either.left({ _tag: "BrowserLoginUserCancelled" })`. The SDK replaces adapter messages with fixed redacted messages.

Errors returned to callers use fixed SDK-owned messages. Cookies, CSRF tokens, redirect details, and account data must not be included in logs or thrown errors.
