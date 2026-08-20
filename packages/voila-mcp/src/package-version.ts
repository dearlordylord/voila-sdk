declare const PKG_VERSION: string | undefined

export const resolvePackageVersion = (version: string | undefined): string =>
  version === undefined || version.length === 0 ? "0.0.0" : version

const buildVersion = typeof PKG_VERSION === "string" ? PKG_VERSION : undefined

export const packageVersion = resolvePackageVersion(buildVersion)
