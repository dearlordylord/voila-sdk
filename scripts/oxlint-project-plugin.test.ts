import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test } from "vitest"

const runFixture = async (source: string, filename = "fixture.ts") => {
  const directory = await mkdtemp(join(process.cwd(), "scripts/.oxlint-fixture-"))
  const fixture = join(directory, filename)

  try {
    await writeFile(fixture, source)
    const pnpmEntryPoint = process.env.npm_execpath
    if (pnpmEntryPoint === undefined) throw new Error("Run harness tests through pnpm")

    const result = spawnSync(
      process.execPath,
      [pnpmEntryPoint, "exec", "oxlint", "-c", "scripts/oxlint-project-plugin.fixture.json", fixture],
      { cwd: process.cwd(), encoding: "utf8" }
    )

    return `${result.stdout}${result.stderr}`
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

test("rejects both TypeScript assertion syntaxes and double assertions", async () => {
  const output = await runFixture(`
    declare const value: unknown
    const first = value as string
    const second = <string>value
    const third = value as unknown as string
    void first; void second; void third
  `)

  expect(output).toContain("voila(no-type-assertion)")
  expect(output).toContain("voila(no-double-type-assertion)")
})

test("rejects ambient clocks, test mocks, and aliased Schema imports", async () => {
  const output = await runFixture(`
    import { Schema as S } from "effect"
    declare const vi: { mock(name: string): void }
    Date.now()
    vi.mock("fixture")
    void S
  `)

  expect(output).toContain("voila(no-clock-read)")
  expect(output).toContain("voila(no-test-mocks)")
  expect(output).toContain("voila(require-canonical-effect-schema-import)")
})

test("requires property tests to use the property-test filename", async () => {
  const output = await runFixture(
    `import fc from "fast-check"; fc.property(fc.anything(), () => true)`,
    "fixture.test.ts"
  )

  expect(output).toContain("voila(property-test-placement)")
})
