# A rotated CSRF token is refreshed from the homepage and retried once

Voila rotates the `X-CSRF-TOKEN` independently of the session cookies, and checks it on writes only. A session snapshot captured at login therefore keeps reading indefinitely — search, cart view, slots, order history — while every write it attempts is answered with a 403 that is indistinguishable, at the HTTP layer, from an expired login.

Decisions:

- **A 401/403 on any operation triggers one refresh and one retry.** `withCsrfRefreshRetry` wraps the request half of every session operation. A refresh that fails, or that finds the token the session already carries, leaves the original rejection standing: an expired login still reports as an expired login, and nothing loops.
- **The refresh reads the server-rendered homepage, which is where the web app gets its own token.** `refreshSessionCsrf` parses `window.__INITIAL_STATE__` for `session.csrf` and `session.metadata`, and adopts both — the page metadata (`assetVersion`, `pageViewId`) belongs to the page that issued the token.
- **The refresh parses the session block alone.** `InitialStateSessionSchema` covers `session.csrf` and `session.metadata` and nothing else. The homepage also carries the basket, the categories, and the adverts; a token rotation that depended on all of them decoding would fail for reasons that have nothing to do with the token.
- **The refreshed session keeps the cookie jar it started from**, with the homepage's `Set-Cookie` folded on top. Replacing the jar is what a guest bootstrap does, and doing it during a refresh would turn a rotated token into a silent downgrade to a guest cart.
- **A refresh that drops the authenticated cookie is refused.** If the snapshot carried `userEmail` and the refreshed one does not, the homepage answered as a guest: the refresh fails as `CsrfRefreshSessionDeauthenticated` and the caller sees the original 403 rather than a write landing in a guest basket. This is the same evidence the session-health check reads.
- **A successful retry persists the refreshed snapshot** through the ordinary session-file cycle, so the next process starts from the current token instead of paying for another refresh.

Consequences: the happy path costs nothing — no probe request, no proactive refresh. A stale-token write costs one extra homepage fetch, once, after which the file holds a current token. The homepage is a large response, so the refresh is deliberately not on the read path's failure handling budget in any other way: it happens once per rejected request, never in a loop.
