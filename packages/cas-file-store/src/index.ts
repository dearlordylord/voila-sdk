// The engine (`modifyCarrying`) is deliberately absent: the public surface is
// the closure-owned read-modify-write cycle, with no primitive that could be
// used to write a state file blindly.
export {
  type CasFileStoreAbsent,
  type CasFileStoreContentsInvalid,
  type CasFileStoreError,
  type CasFileStoreReadFailure,
  type CasFileStoreWriteFailure,
  type ConflictExhausted,
  type ConflictPolicy,
  dropPolicy,
  keep,
  modify,
  type ModifyOutcome,
  persist,
  read,
  retryPolicy,
  type WriteDecision
} from "./cas-file-store.js"
export { modifySchema, modifySchemaCarrying, type CarriedModifyOutcome, type SchemaCycleStep } from "./schema.js"
export {
  makeStateFileLocks,
  StateFileLocks,
  type StateFileLocksService,
  StateFileLocksLive,
  stateFileLocksLayer
} from "./state-file-locks.js"
export {
  type CasFileStorePathInvalid,
  parseStateFilePath,
  type StateFilePath,
  StateFilePathSchema
} from "./state-file-path.js"
