export interface OracleTaggedValue {
  readonly $oracle: string
  readonly value?: string
}

export type OracleValue =
  | null
  | boolean
  | number
  | string
  | OracleTaggedValue
  | ReadonlyArray<OracleValue>
  | { readonly [key: string]: OracleValue }

export interface OracleDifference {
  readonly after: OracleValue
  readonly before: OracleValue
  readonly path: string
}

export interface DifferenceAllowlistEntry {
  readonly after: unknown
  readonly before: unknown
  readonly path: string
  readonly rationale?: string
  readonly evidence?: ReadonlyArray<string>
}

export interface DifferenceAllowlist {
  readonly version: number
  readonly entries: ReadonlyArray<DifferenceAllowlistEntry>
  readonly groups?: ReadonlyArray<DifferenceAllowlistGroup>
}

export interface DifferenceAllowlistGroup {
  readonly count: number
  readonly diffHash: string
  readonly evidence?: ReadonlyArray<string>
  readonly prefix: string
  readonly rationale?: string
}

export interface ReviewedAllowlistEntry extends DifferenceAllowlistEntry {
  readonly rationale: string
  readonly evidence: ReadonlyArray<string>
}

export interface ReviewedAllowlist {
  readonly version: 1
  readonly entries: ReadonlyArray<ReviewedAllowlistEntry>
  readonly groups?: ReadonlyArray<ReviewedAllowlistGroup>
}

export interface ReviewedAllowlistGroup extends DifferenceAllowlistGroup {
  readonly rationale: string
  readonly evidence: ReadonlyArray<string>
}

export interface ClassifiedDifferences {
  readonly differences: Array<OracleDifference>
  readonly invalid: ReadonlyArray<Record<string, unknown>>
  readonly stale: Array<DifferenceAllowlistEntry | DifferenceAllowlistGroup>
  readonly unclassified: Array<OracleDifference>
}

export declare const oracleVersion: 1
export declare const draft07SchemaUri: "http://json-schema.org/draft-07/schema#"
export declare const undefinedMarker: OracleTaggedValue
export declare const missingMarker: OracleTaggedValue

export declare const toOracleValue: (value: unknown, seen?: WeakSet<object>) => OracleValue
export declare const canonicalJson: (value: unknown) => string
export declare const sha256: (value: unknown) => string
export declare const hashFile: (path: string) => Promise<string>
export declare const structuralDiff: (
  before: unknown,
  after: unknown,
  path?: string,
  differences?: Array<OracleDifference>
) => Array<OracleDifference>
export declare const canonicalDifferenceHash: (differences: ReadonlyArray<OracleDifference>) => string
export declare const classifyDifferences: (
  before: unknown,
  after: unknown,
  allowlist?: DifferenceAllowlist
) => ClassifiedDifferences
export declare const validateAllowlist: (allowlist: unknown) => ReviewedAllowlist
export declare const assertReviewedParity: (
  before: unknown,
  after: unknown,
  allowlist: DifferenceAllowlist
) => ClassifiedDifferences
export declare const validateDraft07: (schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>) => Promise<void>
export declare const readOracle: (path: string) => Promise<unknown>
export declare const writeOracle: (path: string, content: unknown) => Promise<unknown>
export declare const writeJson: (path: string, value: unknown) => Promise<void>
export declare const normalizePackageVersion: (value: unknown) => unknown
export declare const normalizeNondeterministic: (value: unknown) => OracleValue
export declare const strictDraft07: () => Promise<unknown>
