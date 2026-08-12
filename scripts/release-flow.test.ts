import { readFile } from "node:fs/promises"

import { Schema } from "effect"
import { expect, test } from "vitest"

const PackageScriptsSchema = Schema.Struct({ scripts: Schema.Struct({ "release:publish": Schema.String }) })

test("publishes an already-prepared release without rebuilding platform tooling", async () => {
  const packageJson = Schema.decodeUnknownSync(PackageScriptsSchema)(JSON.parse(await readFile("package.json", "utf8")))
  const publishScript = packageJson.scripts["release:publish"]

  expect(publishScript).toContain("publish-registry-tag.mjs --check")
  expect(publishScript).toContain("verify-registry-metadata")
  expect(publishScript).toContain("validate-registry-schema")
  expect(publishScript).toContain("publish-if-needed.mjs")
  expect(publishScript).toContain("publish-registry-tag.mjs")
  expect(publishScript).not.toMatch(/install|rebuild|check-all|release:check/)

  const publishImplementation = await readFile("scripts/publish-if-needed.mjs", "utf8")

  expect(publishImplementation).toContain('"--ignore-scripts"')
})
