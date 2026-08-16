# Voila

Personal automation SDK for Voila grocery workflows: an unofficial client SDK, an MCP server, and a CLI, sharing one session-on-disk model.

## Language

**Session snapshot**:
The serialized on-disk session state: cookie jar, CSRF token, and page metadata, stored as one JSON file. Multiple local processes (CLI, MCP server, keepalive service) may share it.
_Avoid_: session file, auth file, cookie store

**Lineage**:
The chain of session snapshots descending from one interactive login. A re-login starts a new lineage; writes descending from an older lineage must never overwrite a newer one.
_Avoid_: generation, version, fork

**CAS token**:
The raw bytes of a state file as read at the start of a read-modify-write cycle. Comparison happens on raw bytes, never on decoded/re-encoded values.
_Avoid_: etag, hash, fingerprint

**Conflict**:
The CAS token no longer matches the file's current bytes at write time — another process wrote in between.
_Avoid_: race, contention

**Dropped**:
The conflict-resolution outcome where the in-flight update is discarded and the on-disk value stands. Correct when the update is regenerable and lineage-bound.
_Avoid_: rejected, failed, lost update

**State file path**:
An absolute path to a local state file, parsed at the edge where it is configured. A relative path is refused: it names different files in two processes with different working directories.
_Avoid_: file name, location, config path

**Guest downgrade**:
An update that would replace an authenticated session snapshot on disk with a guest one. Refused: a guest session is rebuildable with one request, an authenticated one costs an interactive browser login.
_Avoid_: logout, session reset, anonymous overwrite
