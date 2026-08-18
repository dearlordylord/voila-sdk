import { expect, test } from "vitest"

import { addSuccessfulOutputLines } from "./quality-output-budget.mjs"

test("accepts output exactly at the budget", () => {
  expect(
    addSuccessfulOutputLines({
      currentOutputLines: 7,
      maximumOutputLines: 10,
      stageName: "fixture",
      stageOutputLines: 3
    })
  ).toBe(10)
})

test("identifies the stage that exceeds the budget", () => {
  expect(() =>
    addSuccessfulOutputLines({
      currentOutputLines: 8,
      maximumOutputLines: 10,
      stageName: "noisy fixture",
      stageOutputLines: 3
    })
  ).toThrow("Quality gate successful output exceeded 10 lines after 'noisy fixture' (11 lines observed)")
})
