export declare const defaultOraclePath: string
export declare const defaultAllowlistPath: string
export declare const verify: (options?: {
  readonly allowlistPath?: string
  readonly baselinePath?: string
}) => Promise<unknown>
