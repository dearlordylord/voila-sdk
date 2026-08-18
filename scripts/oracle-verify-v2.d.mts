export declare const defaultSupplementalOraclePath: string
export declare const defaultSupplementalAllowlistPath: string
export declare const verifySupplemental: (options?: {
  readonly allowlistPath?: string
  readonly baselinePath?: string
}) => Promise<unknown>
