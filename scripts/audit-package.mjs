import { execFileSync } from "node:child_process"

const requiredFiles = [
  "LICENSE",
  "README.md",
  "dist/src/index.d.ts",
  "dist/src/index.js",
  "package.json"
]

const allowedDistExtensions = [
  ".d.ts",
  ".d.ts.map",
  ".js",
  ".js.map"
]

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8"
})
const [pack] = JSON.parse(output)
const paths = pack.files.map((file) => file.path)

const missing = requiredFiles.filter((path) => !paths.includes(path))

if (missing.length > 0) {
  throw new Error(`Package is missing required files: ${missing.join(", ")}`)
}

const unexpectedFiles = paths.filter((path) =>
  !requiredFiles.includes(path) && !path.startsWith("dist/src/")
)

if (unexpectedFiles.length > 0) {
  throw new Error(`Package contains unexpected files: ${unexpectedFiles.join(", ")}`)
}

const leaked = paths.filter((path) =>
  path.startsWith("dist/test/")
  || path.startsWith("test/")
  || path.startsWith("src/")
  || path.endsWith(".tsbuildinfo")
)

if (leaked.length > 0) {
  throw new Error(`Package contains non-publishable files: ${leaked.join(", ")}`)
}

const invalidDistFiles = paths.filter((path) =>
  path.startsWith("dist/") && (
    !path.startsWith("dist/src/")
    || !allowedDistExtensions.some((extension) => path.endsWith(extension))
  )
)

if (invalidDistFiles.length > 0) {
  throw new Error(`Package contains unexpected dist files: ${invalidDistFiles.join(", ")}`)
}

const missingDeclarationFiles = paths
  .filter((path) => path.startsWith("dist/src/") && path.endsWith(".js"))
  .map((path) => path.replace(/\.js$/, ".d.ts"))
  .filter((path) => !paths.includes(path))

if (missingDeclarationFiles.length > 0) {
  throw new Error(`Package JavaScript files are missing declarations: ${missingDeclarationFiles.join(", ")}`)
}

console.log(`Package audit passed with ${paths.length} files`)
