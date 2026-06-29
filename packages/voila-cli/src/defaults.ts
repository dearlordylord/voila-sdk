import { homedir } from "node:os"
import { join } from "node:path"

export const defaultSessionPath = (): string => join(homedir(), ".config", "voila", "session.json")

export const defaultBrowserProfilePath = (): string => join(homedir(), ".cache", "voila", "browser-profile")
