export declare const defaultOraclePath: string
export declare const exactEffect3Version: "3.22.1"
export declare const assertCaptureEnvironment: (rootPath?: string) => Promise<true>
export declare const capture: (
  outputPath?: string,
  options?: { readonly provenance?: unknown; readonly supplemental?: boolean }
) => Promise<unknown>
