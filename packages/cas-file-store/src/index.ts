// The engine (`modifyCarrying`) is deliberately absent: the public surface is
// the closure-owned read-modify-write cycle, with no primitive that could be
// used to write a state file blindly.
export {
  type CasFileStoreContentsInvalid,
  type CasFileStoreError,
  type CasFileStoreReadFailure,
  type CasFileStoreWriteFailure,
  type ConflictExhausted,
  type ConflictPolicy,
  dropPolicy,
  modify,
  type ModifyOutcome,
  read,
  retryPolicy
} from "./cas-file-store.js"
export { modifySchema } from "./schema.js"
