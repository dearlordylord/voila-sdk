export interface OracleArtifactFile {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface OracleDependency {
  readonly name: string
  readonly requested: unknown
  readonly version: string
}

export interface OracleArtifact {
  readonly bin: unknown
  readonly bundleComposition: Readonly<Record<string, ReadonlyArray<string> | {
    readonly reason: string
    readonly status: "unavailable"
  }>>
  readonly bundleCompositionStatus: Readonly<Record<string, "available" | {
    readonly reason: string
    readonly status: "unavailable"
  }>>
  readonly dependencyClosure: ReadonlyArray<OracleDependency>
  readonly entryPoints: unknown
  readonly files: ReadonlyArray<OracleArtifactFile>
  readonly name: string
  readonly version: string
}

export declare const assertFreshBuiltArtifacts: (rootPath?: string) => Promise<true>
export declare const artifactManifest: (rootPath?: string) => Promise<ReadonlyArray<OracleArtifact>>
