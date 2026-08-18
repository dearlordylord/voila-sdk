import { Context, type Effect } from "effect"

import type { ResponseHeaders } from "./headers.js"
import type { VoilaTransportError } from "./transport-error.js"

export type VoilaHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT"

export interface VoilaTransportRequest {
  readonly body?: string
  readonly headers: Readonly<Record<string, string>>
  readonly method: VoilaHttpMethod
  readonly url: URL
}

export interface VoilaTransportResponse {
  readonly body: string
  readonly headers: ResponseHeaders
  readonly status: number
}

/**
 * The one place the SDK touches the network, and it touches it through the
 * environment rather than a passed argument: an operation declares that it
 * needs a transport in its type, and whoever runs it decides what that is. The
 * SDK ships no implementation — it stays platform-agnostic, and the Node
 * implementation lives with the process that has a Node runtime.
 */
export interface VoilaTransportService {
  readonly request: (request: VoilaTransportRequest) => Effect.Effect<VoilaTransportResponse, VoilaTransportError>
}

export class VoilaTransport extends Context.Service<VoilaTransport, VoilaTransportService>()(
  "@firfi/voila-sdk/VoilaTransport"
) {}
