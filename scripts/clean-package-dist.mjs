import { rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageNames = ["voila-cli", "voila-mcp", "voila-sdk", "voila-session-store"]
const packageDirectories = packageNames.map((name) => join(workspaceRoot, "packages", name))

export const resolvePackageDist = (packageDirectory, allowedPackageDirectories = packageDirectories) => {
  const resolvedPackageDirectory = resolve(packageDirectory)
  if (!allowedPackageDirectories.map((directory) => resolve(directory)).includes(resolvedPackageDirectory)) {
    throw new Error(`Refusing to clean dist outside a workspace package: ${resolvedPackageDirectory}`)
  }
  return join(resolvedPackageDirectory, "dist")
}

export const cleanPackageDist = async (
  packageDirectory = process.cwd(),
  allowedPackageDirectories = packageDirectories
) => rm(resolvePackageDist(packageDirectory, allowedPackageDirectories), { force: true, recursive: true })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await cleanPackageDist()
}
