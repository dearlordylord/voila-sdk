export interface BoundedCommandOptions {
  readonly args: ReadonlyArray<string>
  readonly executable: string
  readonly forwardOutput?: boolean
  readonly name: string
  readonly terminationGraceMilliseconds?: number
  readonly timeoutMilliseconds: number
}

export interface BoundedCommandResult {
  readonly outputLineCount: number
}

export declare const runBoundedCommand: (options: BoundedCommandOptions) => Promise<BoundedCommandResult>
