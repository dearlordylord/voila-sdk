import type { SdkSessionSnapshot } from "@firfi/voila-sdk"

const defaultSessionPath = "~/.config/voila/session.json"

export interface OperationAuthGuidance {
  readonly command: string
  readonly instructions: string
  readonly mcpEnv: Readonly<Record<"VOILA_AUTH_SESSION_PATH", string>>
  readonly message: string
}

export const makeAuthGuidance = (sessionPath?: string): OperationAuthGuidance => {
  const path = sessionPath ?? defaultSessionPath

  return {
    command: `npx -y @firfi/voila-cli auth login --session ${path}`,
    instructions: [
      "Run the command, log in in the browser, close the browser window to save, then retry the MCP request.",
      "MCP does not launch the browser itself."
    ].join(" "),
    mcpEnv: {
      VOILA_AUTH_SESSION_PATH: path
    },
    message: "Voila account session is required for account-specific cart and authenticated grocery workflows."
  }
}

export const authGuidanceForSnapshot = (
  authGuidance: OperationAuthGuidance | undefined,
  snapshot: SdkSessionSnapshot
): OperationAuthGuidance | undefined => snapshot.kind === "guest" ? authGuidance : undefined

export const authGuidanceForHealth = (
  authGuidance: OperationAuthGuidance | undefined,
  health: { readonly session: SdkSessionSnapshot; readonly status: string }
): OperationAuthGuidance | undefined =>
  health.session.kind === "guest" || health.status === "reauth-required" || health.status === "unauthorized"
    ? authGuidance
    : undefined
