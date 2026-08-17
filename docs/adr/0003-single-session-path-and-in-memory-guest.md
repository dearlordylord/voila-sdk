# One configured session path, and a guest session that never reaches disk

Every read and write of a session snapshot goes through `@firfi/voila-session-store`. The MCP server and the CLI hold no session of their own to write back: an operation runs inside the store's update cycle, sees the snapshot as it exists on disk at that moment, and reports its refresh as a transform over that same value.

Decisions:

- **One configured state file path.** `VOILA_AUTH_SESSION_PATH` names the snapshot the MCP server reads and the snapshot it writes. A separate write path leaves the CAS comparison guarding a file nobody reads, which guarantees nothing. The path is parsed into a `StateFilePath` at the environment boundary, so a relative spelling cannot name two different files in two processes. The CLI resolves its `--session` argument to an absolute path at the same edge.
- **A guest session is never persisted.** It lives in memory for the process's lifetime and costs one request to rebuild. Writing it is what allows a guest bootstrap to land on top of an authenticated login, and the store's guest-downgrade refusal is a second line of defence rather than the mechanism.
- **The snapshot cached at boot is gone.** The configured snapshot is read inside every cycle, so an interactive login that lands between two operations is used by the next one without a restart, and the snapshot an operation started from can never overwrite it.
- **A login whose write is dropped reports it.** `persistLoginSession` maps a dropped write to `VoilaAuthSessionSuperseded` instead of retrying: retrying would write the login on top of whatever newer lineage won, which is the revert this path exists to prevent.

Consequences: the MCP operation layer is Effect end to end, so an operation composes with the cycle directly. Operation results travel back on the cycle's carry channel — including through a dropped conflict — so no caller smuggles a result out through a captured variable. Because the operation's request runs inside the cycle, tool calls sharing one session path are serialized in-process: the alternative, requesting before the cycle, reopens the read-decide gap the store exists to close.
