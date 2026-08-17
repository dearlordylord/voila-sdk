import type { SdkSessionSnapshot } from "@firfi/voila-sdk"
import type { StateFilePath } from "@firfi/voila-session-store"
import { Schema } from "effect"

// what to suggest when no path is configured: shell-expanded rather than
// absolute, so it is guidance text and not a `StateFilePath`
const defaultSessionPath = "~/.config/voila/session.json"

// guidance is part of every tool result that carries it, so the schema owns
// the shape rather than a hand-written interface
export const OperationAuthGuidanceSchema = Schema.Struct({
  command: Schema.String,
  instructions: Schema.String,
  mcpEnv: Schema.Struct({ VOILA_AUTH_SESSION_PATH: Schema.String }),
  message: Schema.String
})

export type OperationAuthGuidance = Schema.Schema.Type<typeof OperationAuthGuidanceSchema>

export const makeAuthGuidance = (sessionPath?: StateFilePath): OperationAuthGuidance => {
  const path = sessionPath ?? defaultSessionPath

  return {
    command: `npx -y @firfi/voila-cli auth login --session ${path}`,
    instructions: [
      "Run the command, log in in the browser, close the browser window to save, then retry the MCP request.",
      "MCP does not launch the browser itself."
    ].join(" "),
    mcpEnv: { VOILA_AUTH_SESSION_PATH: path },
    message: "Voila account session is required for account-specific cart and authenticated grocery workflows."
  }
}

export const authGuidanceForSnapshot = (
  authGuidance: OperationAuthGuidance | undefined,
  snapshot: SdkSessionSnapshot
): OperationAuthGuidance | undefined => (snapshot.kind === "guest" ? authGuidance : undefined)

export const authGuidanceForHealth = (
  authGuidance: OperationAuthGuidance | undefined,
  health: { readonly session: SdkSessionSnapshot; readonly status: string }
): OperationAuthGuidance | undefined =>
  health.session.kind === "guest" || health.status === "reauth-required" || health.status === "unauthorized"
    ? authGuidance
    : undefined
