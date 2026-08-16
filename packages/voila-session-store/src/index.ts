// One update operation is the whole surface: no `save`, `write`, or
// `initialize` entry point exists beside it, so a blind write of a snapshot
// loaded earlier is not expressible through this API.
export {
  type SessionFileContentsInvalid,
  type SessionFileError,
  type SessionFileGuestOverwriteRefused,
  type SessionFileReadFailure,
  type SessionFileWriteFailure
} from "./session-file-errors.js"
export {
  keepSessionFile,
  persistSession,
  type SessionFileUpdate,
  type SessionFileUpdateOutcome,
  updateSessionFile
} from "./session-file-store.js"
