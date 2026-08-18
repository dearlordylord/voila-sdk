export type PackageManager = "pnpm" | "npm"

export declare const parseManagerArguments: (args: ReadonlyArray<string>) => Array<PackageManager>

export declare const runCleanConsumerMatrix: (managers?: ReadonlyArray<PackageManager>) => void
