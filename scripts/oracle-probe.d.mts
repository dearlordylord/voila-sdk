export interface OracleTool {
  readonly name: string
  readonly [key: string]: unknown
}

export interface OracleArtifact {
  readonly files: ReadonlyArray<unknown>
  readonly [key: string]: unknown
}

export interface OracleParsedValue {
  readonly _tag: string
  readonly [key: string]: unknown
}

export interface OracleParsed {
  readonly "catalog-search": OracleParsedValue
  readonly "category-products": OracleParsedValue
  readonly "cart-view": OracleParsedValue
  readonly "cart-mutation": OracleParsedValue
  readonly discounts: OracleParsedValue
  readonly slots: OracleParsedValue
  readonly "slot-reservation": OracleParsedValue
  readonly "checkout-summary": OracleParsedValue
}

export type OracleJsonSchema = Readonly<Record<string, unknown>>

export interface OracleCorpus {
  readonly artifacts: ReadonlyArray<OracleArtifact>
  readonly cli: {
    readonly results: ReadonlyArray<unknown>
    readonly [key: string]: unknown
  }
  readonly mcp: {
    readonly tools: ReadonlyArray<OracleTool>
    readonly protocol: {
      readonly health: ReadonlyArray<unknown>
      readonly succeeded: { readonly body?: unknown; readonly [key: string]: unknown }
      readonly foreignOrigin: { readonly status: number; readonly [key: string]: unknown }
      readonly [key: string]: unknown
    }
    readonly [key: string]: unknown
  }
  readonly sdk: {
    readonly parsed: OracleParsed
    readonly codec: {
      readonly guestDiagnostic: { readonly csrf: "[redacted]"; readonly [key: string]: unknown }
      readonly [key: string]: unknown
    }
    readonly [key: string]: unknown
  }
  readonly stdio: {
    readonly initialize: {
      readonly result: {
        readonly serverInfo: { readonly name: string; readonly [key: string]: unknown }
        readonly [key: string]: unknown
      }
      readonly [key: string]: unknown
    }
    readonly [key: string]: unknown
  }
  readonly [key: string]: unknown
}

export declare const captureOracleCorpus: (options?: { readonly supplemental?: boolean }) => Promise<OracleCorpus>
export declare const wireToolSchemas: (protocol: unknown) => Record<string, OracleJsonSchema>
export declare const wireDraft07Schemas: (protocol: unknown) => Record<string, OracleJsonSchema>
