/**
 * What a transport can fail with, and nothing more. Every variant carries a
 * static message and no material from the request: a failure that reached a
 * tool result or a log must never be the place a cookie, a CSRF token, or a
 * request URL escapes. The three tags stay distinguishable downstream because
 * they are what a caller can act on differently — wait and retry, check the
 * network, or treat the endpoint as broken.
 *
 * Plain tagged literals rather than schema-derived structs: these values are
 * never parsed from or encoded to a boundary payload, they are only produced
 * here and read by `redactError`, which whitelists `_tag`/`message`/`status`.
 */
export type VoilaTransportError =
  | { readonly _tag: "VoilaRequestDeadlineExceeded"; readonly message: string; readonly timeoutMs: number }
  | { readonly _tag: "VoilaConnectionFailure"; readonly message: string }
  | { readonly _tag: "VoilaResponseReadFailure"; readonly message: string }

export const requestDeadlineExceeded = (timeoutMs: number): VoilaTransportError => ({
  _tag: "VoilaRequestDeadlineExceeded",
  message: "Voila request exceeded its deadline",
  timeoutMs
})

export const connectionFailure = (): VoilaTransportError => ({
  _tag: "VoilaConnectionFailure",
  message: "Voila request could not reach the server"
})

export const responseReadFailure = (): VoilaTransportError => ({
  _tag: "VoilaResponseReadFailure",
  message: "Voila response body could not be read"
})
