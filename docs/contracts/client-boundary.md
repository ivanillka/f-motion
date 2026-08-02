# F-Engine client boundary

## Ownership

The versioned HTTP/SSE API is authoritative. It owns account state,
authorization, project snapshots, each project's monotonic revision, media
assets, concepts, render jobs, and render results. It performs authoritative
validation, asset admission, media inspection, command ordering, and render
truth.

Reference clients own only their framework UI, accessibility behavior, native
media playback, secure-token adapter, and replaceable local cache. Reel Engine
is server/worker TypeScript; it is neither shipped to non-TypeScript clients
nor reimplemented in them. Clients never synchronize directly.

## Commands and responses

Every mutation uses a command envelope containing:

- `command_id`: client-generated idempotency identifier;
- `project_id`;
- `base_revision`: the authoritative revision the edit was based on;
- a command kind and its validated payload;
- a client timestamp used for diagnostics only, never ordering or truth.

Success returns the authoritative revision and project snapshot. Failure
returns a typed conflict or error. A stale `base_revision` is rejected; the API
must **never auto-merge** client edits. The client refreshes from the
authoritative snapshot and asks the user to reapply an edit when necessary.

## Assets, jobs, and progress

Upload admission returns a scoped upload target and asset identifier. Upload
completion only asks the API to inspect the object; clients never declare
detected media truth such as duration, codec, dimensions, or safety. The API
admits or rejects the inspected asset.

Jobs expose progress through versioned SSE events with monotonically increasing
event IDs. Reconnection sends the last received event ID; the API resumes from
that event when retained or returns the latest authoritative job snapshot.
Completion refers to an immutable render result owned by the API.

## Errors, retries, and local drafts

Shared error codes define stable machine meaning and explicit retryability.
Presentation copy remains client-owned. Authentication, validation, conflict,
quota, unavailable, and terminal-render errors must remain distinguishable.
Only errors marked retryable may be automatically retried, using the original
`command_id`.

Offline drafts and queued commands are local, replaceable projections until
acknowledged by the API. They are never authoritative, never transferred
directly between clients, and may be discarded after reconciliation with a
newer server snapshot.

## Evolution and compatibility

The boundary is language-neutral OpenAPI and JSON Schema, not a shared
TypeScript UI or state package. Additive fields may evolve within a contract
version when clients tolerate unknown fields. Breaking semantic or structural
changes require an explicit new version and migration window.

Checked-in request, response, error, and event fixtures plus contract tests
must exercise both TypeScript and Dart consumers. The inventory in
`packages/contracts/route-inventory.json` and `packages/contracts/openapi.yaml`
must stay aligned with Express registration. `/api` remains the production
prefix; `/v1` is an identical compatibility alias. Generated clients may follow
in a production plan; this document freezes ownership and wire semantics only.
