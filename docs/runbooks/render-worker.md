# Render worker

The API creates a revision-bound render job and reconnectable progress stream.
Only the worker executes FFmpeg. A render uses the immutable key
`projects/{project}/renders/{revision}.mp4`; retries therefore cannot create a
second logical result.

Investigate a stuck job by request ID and job ID, then inspect pg-boss lease,
heartbeat, retry, and cancellation state. Do not run FFmpeg in the API as a
fallback. Cancellation must remove a partial local file. An expired worker
lease is recovered by another worker.

## Outbox retention

Set `OUTBOX_RETENTION_HOURS` to a positive number of hours; the default is 168
(seven days), and invalid values stop worker startup. After its startup dispatch,
the worker deletes at most 250 old dispatched outbox rows, then repeats at most
hourly. Cleanup never deletes an undispatched row. A growing undispatched count
or oldest-undispatched age indicates delivery trouble and must be investigated;
do not shorten retention to hide it.

## Render-input migration rollout

Choose the rollout path before applying the render-input migration. Prefer to
pause new render admission while workers and outbox dispatch drain all `queued`
and `running` jobs. Then pause dispatch, apply the migration, deploy the
snapshot-writing API and snapshot-reading worker, and resume rendering.

If jobs cannot be drained, keep render admission and dispatch paused while the
migration runs. Historical jobs are backfilled only when the project's current
revision still equals the job revision. A revision-mismatched `queued` or
`running` job receives a terminal `failed` event and becomes failed; its input
is deliberately invalid, so it cannot render current content under an older
revision. Revision-equal jobs receive the current revision's snapshot, which the
updated worker validates before any media work, and remain eligible to render.
Deploy the updated API and worker before resuming admission or dispatch.
