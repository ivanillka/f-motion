# Media quarantine

Upload admission validates owner, project, declared type, and configured size.
Its five-minute signed PUT targets only the asset's quarantine key. Completion
only moves the asset to inspection. The worker detects MIME, container,
dimensions, duration, and bytes; client metadata is never promoted to
authoritative media facts.

For accepted media, the worker records the inspected quarantine ETag and
SHA-256 digest before conditionally copying those bytes to a separate sealed
key. It verifies the sealed digest, records the sealed key and identity, marks
the asset ready, and only then deletes quarantine. Render downloads require the
recorded sealed ETag and digest to match; a missing or changed object fails the
render without falling back to quarantine.

Keep mismatched, oversized, corrupt, and cross-project objects quarantined.
Record the reason without logging signed URLs or media content. An operator may
retry inspection after correcting an infrastructure failure, but must never
manually mark an uninspected object ready.

The worker bounds every `ffprobe` to 10 seconds and cancels probes and object
downloads when the queue lease expires or the job is cancelled. It accepts at
most 4096 pixels on either axis, 16,000,000 pixels total, and 60 seconds of
source video. Configure these startup-validated ceilings with
`MEDIA_PROBE_TIMEOUT_MS`, `MEDIA_MAX_WIDTH`, `MEDIA_MAX_HEIGHT`,
`MEDIA_MAX_PIXELS`, and `MEDIA_MAX_VIDEO_DURATION_MS`.

Treat these values as safety limits. Review them when adding a media type or
render profile and measure peak worker memory before changing them. Never
silently raise a limit; update configuration and this runbook in the same
reviewed deployment change.

## Rollout and existing media

Apply the seal migration before starting the new API and worker. The migration
moves every existing `ready` asset back to `inspecting` and requeues it because
the identity of its old client-writable object cannot be proved. Do not bypass
that reinspection or bulk-fill sealed columns. Assets become attachable and
renderable again as their inspections finish.

Deploy the API and worker together after the migration. During rollback, stop
new uploads and inspection/render dispatch before reverting application code.
Do not run an older worker against the migrated data or reverse the migration
by relabeling assets ready. Prefer fixing forward; if binaries must be reverted,
restore the pre-migration database and object-store snapshot as one unit so the
two systems agree.

Inspection retries are safe after either a completed copy with a failed database
write or a completed database write with failed quarantine cleanup. Requeue the
same inspection payload; do not create a replacement asset or edit identities.

## Cleanup

List orphan candidates by comparing private object keys with media rows. A
quarantine object is removable only when its asset is already ready or the row
no longer exists and the upload/inspection retry window has elapsed. A sealed
object is removable only when no media row references its sealed key. Review the
candidate set before deletion, and never include signed URLs, object contents,
credentials, ETags, versions, or digests in tickets or logs.
