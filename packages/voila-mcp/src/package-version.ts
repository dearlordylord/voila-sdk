declare const PKG_VERSION: string | undefined

export const packageVersion = typeof PKG_VERSION === "string" && PKG_VERSION.length > 0 ? PKG_VERSION : "0.0.0"
