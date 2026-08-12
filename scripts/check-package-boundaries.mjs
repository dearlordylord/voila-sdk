import { readFile, readdir } from "node:fs/promises"

const packagePolicy = {
  "voila-cli": {
    allowedWorkspaceDependencies: ["@firfi/voila-mcp", "@firfi/voila-sdk"],
    declarationDirectory: "dist/types/",
    publishedFiles: [
      "dist/*.cjs",
      "dist/*.mjs",
      "dist/types/**/*.d.ts",
      "dist/types/**/*.d.ts.map",
      "LICENSE",
      "README.md"
    ]
  },
  "voila-mcp": {
    allowedWorkspaceDependencies: ["@firfi/voila-sdk"],
    declarationDirectory: "dist/types/",
    publishedFiles: [
      "dist/*.cjs",
      "dist/*.mjs",
      "dist/types/**/*.d.ts",
      "dist/types/**/*.d.ts.map",
      "LICENSE",
      "README.md"
    ]
  },
  "voila-sdk": { allowedWorkspaceDependencies: [], declarationDirectory: "dist/src/", publishedFiles: ["dist/src"] }
}

const workspacePrefix = "@firfi/voila-"
const dependencySections = ["dependencies", "optionalDependencies", "peerDependencies"]

const filesBelow = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory)

      return entry.isDirectory() ? filesBelow(url) : [url]
    })
  )

  return nested.flat()
}

for (const [packageDirectory, policy] of Object.entries(packagePolicy)) {
  const packageRoot = new URL(`../packages/${packageDirectory}/`, import.meta.url)
  const declarationOutput = new URL(policy.declarationDirectory, packageRoot)
  const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"))
  if (JSON.stringify(manifest.files) !== JSON.stringify(policy.publishedFiles)) {
    throw new Error(`${manifest.name} publish files differ from the checked package boundary policy`)
  }

  const workspaceDependencies = dependencySections
    .flatMap((section) => Object.keys(manifest[section] ?? {}))
    .filter((dependency) => dependency.startsWith(workspacePrefix))
    .toSorted()

  if (JSON.stringify(workspaceDependencies) !== JSON.stringify(policy.allowedWorkspaceDependencies)) {
    throw new Error(
      `${manifest.name} workspace dependencies must be ${policy.allowedWorkspaceDependencies.join(", ") || "empty"}; found ${
        workspaceDependencies.join(", ") || "empty"
      }`
    )
  }

  const emittedFiles = await filesBelow(declarationOutput)

  for (const file of emittedFiles) {
    const relativePath = decodeURIComponent(file.href.slice(declarationOutput.href.length))

    if (relativePath.endsWith(".d.ts")) {
      const declaration = await readFile(file, "utf8")

      if (/(?:from\s+|import\()["'][^"']+\.ts["']/u.test(declaration)) {
        throw new Error(`TypeScript source import was emitted in ${manifest.name}: ${relativePath}`)
      }
    }
  }

  const sourceFiles = (await filesBelow(new URL("src/", packageRoot))).filter((file) => file.pathname.endsWith(".ts"))
  const forbiddenPackages = Object.keys(packagePolicy)
    .map((name) => `${workspacePrefix}${name}`)
    .filter((name) => !policy.allowedWorkspaceDependencies.includes(name))

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8")
    for (const forbiddenPackage of forbiddenPackages) {
      if (source.includes(`"${forbiddenPackage}"`) || source.includes(`'${forbiddenPackage}'`)) {
        throw new Error(`${manifest.name} imports forbidden ${forbiddenPackage}: ${file.pathname}`)
      }
    }

    if (/(?:from\s+|import\()["'][^"']*\.\.\/\.\.\/voila-(?:sdk|mcp|cli)\//u.test(source)) {
      throw new Error(`${manifest.name} uses a relative cross-package import: ${file.pathname}`)
    }
  }
}

console.log("Workspace package boundaries and emitted declarations are valid.")
