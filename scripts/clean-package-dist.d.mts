export declare const resolvePackageDist: (
  packageDirectory: string,
  allowedPackageDirectories?: ReadonlyArray<string>
) => string
export declare const cleanPackageDist: (
  packageDirectory?: string,
  allowedPackageDirectories?: ReadonlyArray<string>
) => Promise<void>
