# Media quarantine

Upload admission validates owner, project, declared type, and configured size.
Completion only moves the asset to inspection. The worker detects MIME,
container, dimensions, duration, and bytes; client metadata is never promoted
to authoritative media facts.

Keep mismatched, oversized, corrupt, and cross-project objects quarantined.
Record the reason without logging signed URLs or media content. An operator may
retry inspection after correcting an infrastructure failure, but must never
manually mark an uninspected object ready.
