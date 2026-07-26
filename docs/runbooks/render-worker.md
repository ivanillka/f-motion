# Render worker

The API creates a revision-bound render job and reconnectable progress stream.
Only the worker executes FFmpeg. A render uses the immutable key
`projects/{project}/renders/{revision}.mp4`; retries therefore cannot create a
second logical result.

Investigate a stuck job by request ID and job ID, then inspect pg-boss lease,
heartbeat, retry, and cancellation state. Do not run FFmpeg in the API as a
fallback. Cancellation must remove a partial local file. An expired worker
lease is recovered by another worker.
