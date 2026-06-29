import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const packageDirectories = [
  "packages/voila-sdk",
  "packages/voila-mcp",
  "packages/voila-cli"
]

const isPublished = (name, version) => {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      stdio: "ignore"
    })

    return true
  } catch {
    return false
  }
}

for (const packageDirectory of packageDirectories) {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"))
  const { name, version } = manifest

  if (isPublished(name, version)) {
    console.log(`skip ${name}@${version}: already published`)
    continue
  }

  console.log(`publish ${name}@${version}`)
  execFileSync("pnpm", ["--dir", packageDirectory, "publish", "--access", "public"], {
    stdio: "inherit"
  })
}
