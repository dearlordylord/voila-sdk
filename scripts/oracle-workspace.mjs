import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

export const oracleWorkspaceRoot = resolve(process.env.ORACLE_WORKSPACE_ROOT ?? sourceRoot)
