import { expect, test } from "vitest"

import * as cohort from "./verify-effect-cohort.mjs"
import type { DependencyDescriptor } from "./verify-effect-cohort.mjs"

const versionedDependency = (version: string, dependencies: Record<string, DependencyDescriptor> = {}) => ({
  dependencies,
  version
})

const completeProject = () => ({
  dependencies: {
    "@effect/language-service": versionedDependency(cohort.LANGUAGE_SERVICE_VERSION),
    "@effect/platform-node": versionedDependency(cohort.EFFECT_COHORT_VERSION, {
      "@effect/platform-node-shared": versionedDependency(cohort.EFFECT_COHORT_VERSION, {
        "@effect/tsgo-linux-arm64": versionedDependency(cohort.TSGO_VERSION)
      }),
      effect: versionedDependency(cohort.EFFECT_COHORT_VERSION),
      redis: versionedDependency(cohort.REDIS_VERSION)
    }),
    "@effect/tsgo": versionedDependency(cohort.TSGO_VERSION),
    "@effect/vitest": versionedDependency(cohort.EFFECT_COHORT_VERSION, {
      effect: versionedDependency(cohort.EFFECT_COHORT_VERSION)
    }),
    "@vitest/coverage-v8": versionedDependency(cohort.VITEST_VERSION, {
      vitest: versionedDependency(cohort.VITEST_VERSION)
    }),
    effect: versionedDependency(cohort.EFFECT_COHORT_VERSION),
    redis: versionedDependency(cohort.REDIS_VERSION),
    vitest: versionedDependency(cohort.VITEST_VERSION)
  }
})

test("collects one version for every installed cohort package", () => {
  const versions = cohort.collectDependencyVersions([completeProject()])

  expect(cohort.evaluateCohort(versions)).toEqual([])
})

test("rejects old and prohibited Effect packages and duplicate versions", () => {
  const versions = cohort.collectDependencyVersions([
    {
      dependencies: {
        ...completeProject().dependencies,
        "@effect/platform": versionedDependency("0.97.1"),
        effect: versionedDependency(cohort.EFFECT_COHORT_VERSION),
        redis: versionedDependency("5.8.2")
      },
      optionalDependencies: { "@effect/tsgo-linux-x64": versionedDependency("0.24.3") }
    }
  ])

  expect(cohort.evaluateCohort(versions)).toEqual(
    expect.arrayContaining([
      "@effect/platform: prohibited package found at 0.97.1",
      "@effect/tsgo-linux-x64: expected only 0.36.5, found 0.24.3",
      "redis: expected only 6.0.0, found 5.8.2, 6.0.0"
    ])
  )
})

test("keeps the supported engine policy explicit", () => {
  expect(cohort.SUPPORTED_NODE_ENGINE).toBe("^22.22.2 || ^24.15.0")
})

test("requires runtime edges appropriate to each clean consumer", () => {
  const complete = cohort.collectDependencyVersions([completeProject()])
  const mcpFailures = cohort.evaluateRuntimeCohort(complete, ["effect", "@effect/platform-node", "redis"])

  expect(mcpFailures).toEqual([])

  const sdkOnly = new Map(complete)
  sdkOnly.delete("@effect/platform-node")
  sdkOnly.delete("redis")

  expect(cohort.evaluateRuntimeCohort(sdkOnly, ["effect"])).toEqual([])
  expect(cohort.evaluateRuntimeCohort(sdkOnly, ["effect", "@effect/platform-node", "redis"])).toEqual(
    expect.arrayContaining([
      "@effect/platform-node: expected only 4.0.0-rc.110, found nothing",
      "redis: expected only 6.0.0, found nothing"
    ])
  )
})
