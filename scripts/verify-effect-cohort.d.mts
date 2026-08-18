import type { Schema } from "effect"

export type DependencyVersionMap = ReadonlyMap<string, ReadonlySet<string>>

export interface DependencyDescriptor extends DependencyProject {
  readonly version?: string
}

export interface DependencyProject {
  readonly dependencies?: Readonly<Record<string, DependencyDescriptor>>
  readonly devDependencies?: Readonly<Record<string, DependencyDescriptor>>
  readonly optionalDependencies?: Readonly<Record<string, DependencyDescriptor>>
}

export declare const DependencyProjectSchema: Schema.Codec<DependencyProject>
export declare const parseDependencyListOutput: (input: string) => ReadonlyArray<DependencyProject>

export declare const EFFECT_COHORT_VERSION: "4.0.0-rc.110"
export declare const TSGO_VERSION: "0.36.5"
export declare const LANGUAGE_SERVICE_VERSION: "0.87.2"
export declare const VITEST_VERSION: "4.1.10"
export declare const REDIS_VERSION: "6.0.0"
export declare const SUPPORTED_NODE_ENGINE: "^22.22.2 || ^24.15.0"

export declare const collectDependencyVersions: (projects: ReadonlyArray<DependencyProject>) => Map<string, Set<string>>
export declare const evaluateCohort: (foundVersions: DependencyVersionMap) => Array<string>
export declare const evaluateRuntimeCohort: (
  foundVersions: DependencyVersionMap,
  requiredRuntimePackages?: ReadonlyArray<string>
) => Array<string>
export declare const verifyWorkspaceEngines: () => Array<string>
export declare const verifyInstalledCohort: () => {
  readonly failures: Array<string>
  readonly foundVersions: Map<string, Set<string>>
  readonly tsgoVersion: string
}
