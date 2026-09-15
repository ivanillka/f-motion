# F-Motion WordPress stub

This is **not** an installable plugin. It names the hooks and REST routes
the real package must keep. Do not copy this folder into `wp-content/plugins`
and expect import to run.

Architecture: [`../../docs/contracts/cms-plugin.md`](../../docs/contracts/cms-plugin.md).  
Import API: [`../../docs/contracts/partner-import.md`](../../docs/contracts/partner-import.md).

## Outline (follow-up package)

```
fmotion.php                 plugin bootstrap, hook registration
includes/class-import.php   POST /v1/integrations/project-imports
includes/class-notify.php   REST notify, signature, download
includes/class-hooks.php    fmotion_before_import / fmotion_reel_ready
admin/settings.php          API origin, import token, owner key (no social)
```

## Hooks other plugins subscribe to

- `fmotion_before_import` (filter): media/brief payload
- `fmotion_after_import` (action): `projectUrl` for link-out Edit
- `fmotion_reel_ready` (action): `post_id`, `attachment_id`, `mp4_url`, `external_id`
- `fmotion_edit_open` (filter): still a new-tab URL, never an iframe

## Non-goals

No social API tokens. No Immich or faces. F-Motion does not post to social.
The host plugin publishes by firing `fmotion_reel_ready`.

## Follow-up

Replace this stub with a packaged plugin that talks to a live F-Motion API
and has one test that a second plugin can `add_action( 'fmotion_reel_ready' )`.
