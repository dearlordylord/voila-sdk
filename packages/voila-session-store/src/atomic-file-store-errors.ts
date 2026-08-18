/** Typed failures for the session store's native Effect file adapter. */

export class ReadError extends Error {
  readonly _tag = "ReadError"

  constructor(readonly path: string) {
    super("State file could not be read")
    this.name = "ReadError"
  }
}

export class WriteError extends Error {
  readonly _tag = "WriteError"

  constructor(readonly path: string) {
    super("State file could not be written")
    this.name = "WriteError"
  }
}

export class ContentsInvalidError extends Error {
  readonly _tag = "ContentsInvalidError"

  constructor(readonly path: string) {
    super("State file contents do not match its schema")
    this.name = "ContentsInvalidError"
  }
}

export class ConflictExhausted extends Error {
  readonly _tag = "ConflictExhausted"

  constructor(readonly path: string) {
    super("State file conflicts exhausted the retry policy")
    this.name = "ConflictExhausted"
  }
}

export class PathInvalidError extends Error {
  readonly _tag = "PathInvalidError"

  constructor() {
    super("State file path is invalid")
    this.name = "PathInvalidError"
  }
}
