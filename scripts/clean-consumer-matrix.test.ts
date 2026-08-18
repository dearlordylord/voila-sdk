import { expect, test } from "vitest"

import { parseManagerArguments } from "./clean-consumer-matrix.mjs"

test("defaults the clean-consumer matrix to both supported package managers", () => {
  expect(parseManagerArguments([])).toEqual(["pnpm", "npm"])
})

test("accepts one package manager for focused local verification", () => {
  expect(parseManagerArguments(["--manager=pnpm"])).toEqual(["pnpm"])
  expect(parseManagerArguments(["--manager=npm"])).toEqual(["npm"])
})

test("rejects unknown package managers", () => {
  expect(() => parseManagerArguments(["--manager=yarn"])).toThrow("expected pnpm, npm, or both")
})
