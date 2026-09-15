# CMS plugin architecture

F-Motion ships to a CMS as a **thin adapter**, not a fork of the engine.
The plugin calls the public import and render contract, then fires CMS
hooks so other plugins can subscribe without knowing F-Motion internals.

Fotium is a custom gallery host that already speaks import-and-open. It is a
reference host, not the only host. WordPress is the first public plugin
target. Drupal, Shopify, and a generic HTTPS webhook use the same events.

This pass documents the architecture and hook names. The WordPress folder
under `plugins/wordpress/` is a stub. A follow-up ships the installable
plugin package (HTTP client, settings UI, media library attach).

Wire contract: [`partner-import.md`](./partner-import.md).  
Recipes: [`../agents/host-recipes.md`](../agents/host-recipes.md).

## Adapter, not a fork

The plugin may:

- `POST /v1/integrations/project-imports` with the import token
- open returned `projectUrl` (link-out Edit in F-Motion)
- receive signed `render.complete` on `notify_url`
- `GET /v1/render-jobs/{id}/download` with the owner API key
- store the MP4 as a CMS attachment or media object
- `do_action` / equivalent so sibling plugins can publish

The plugin must not:

- vendor or patch F-Engine
- reimplement storyboard, FFmpeg, or render workers
- hold social network API tokens
- run Immich, face index, or people search
- iframe the studio until auth/session handoff exists

F-Motion does not post to social. Sibling CMS plugins do.

## Canonical events

Stable names for any CMS. Payloads are JSON-shaped maps. Unknown extra
keys are ignored by F-Motion and passed through by the plugin.

### `before_import` (filter)

Runs after the user picks media in the CMS, before the plugin POSTs import.

Mutate or replace:

- `external_id` (string, required after the filter, stable, idempotent)
- `media_urls` (HTTPS URLs the F-Motion API will fetch)
- `title`, `caption`, `call_to_action`, `visual_hint`
- `architecture` (duration, goal, audience, structure, tone, pace, media)

Social, SEO, or gallery plugins can add a CTA, drop a still, or rewrite
the caption. They do not call F-Motion themselves.

### `after_import` (action)

Fires when import returns `201` or `200`.

- `external_id`
- `project_id`
- `projectUrl` (open this in a new tab; do not iframe yet)
- `created` (boolean)
- `revision`

### `reel_ready` (action)

Fires after the plugin verifies `X-F-Motion-Signature`, downloads the MP4,
and stores it in the CMS. This is the hook sibling plugins should subscribe
to.

- `external_id`
- `job_id`
- `project_id`
- `kind` (`preview` or `final`)
- `mp4_url` (CMS-local or signed URL the host owns)
- `post_id` (CMS post or node id when the plugin created or updated one)
- `attachment_id` (media library / file id when attached)

No F-Motion job internals, storage keys, or import tokens.

### Optional: `edit_open` (filter)

Last chance to adjust `projectUrl` before the link-out. Still a new tab.
Do not turn this into an iframe.

## WordPress (first public target)

Prefix: `fmotion_`. REST namespace: `fmotion/v1`.

| Canonical | WordPress |
|---|---|
| `before_import` | `apply_filters( 'fmotion_before_import', $payload )` |
| `after_import` | `do_action( 'fmotion_after_import', $result )` |
| `reel_ready` | `do_action( 'fmotion_reel_ready', $event )` |
| `edit_open` | `apply_filters( 'fmotion_edit_open', $project_url, $result )` |

REST (plugin-owned, not the F-Motion API):

- `POST /wp-json/fmotion/v1/notify` : `notify_url` target. Verify signature,
  download, attach, then `fmotion_reel_ready`.
- `POST /wp-json/fmotion/v1/import` : admin or capability-gated start import
  from selected attachment IDs.

Settings (follow-up package): API origin, import token, owner API key,
notify secret. Tokens stay in WordPress options, never in the theme, never
in `VITE_*`.

Sibling plugin example:

```php
add_action( 'fmotion_reel_ready', function ( array $event ): void {
  // Yoast / Rank Math / a gallery plugin / a social scheduler.
  // Use $event['post_id'], $event['attachment_id'], $event['mp4_url'],
  // $event['external_id']. Do not call F-Motion from here.
} );
```

Stub: [`../../plugins/wordpress/`](../../plugins/wordpress/).

## Same pattern elsewhere

**Drupal.** `hook_fmotion_before_import_alter(array &$payload)` and
`hook_fmotion_reel_ready(array $event)`. Route `/fmotion/notify`.

**Shopify.** App webhook or Flow trigger `fmotion/reel_ready` with the same
fields. Theme app extension may link-out Edit. Do not iframe checkout or
admin.

**Generic webhook host.** Subscribe to F-Motion `render.complete`, download,
then POST the `reel_ready` JSON to other apps you own. Fotium already does
the custom-host version of this without a CMS plugin.

## Non-goals

- Social API tokens (Meta, TikTok, YouTube, LinkedIn) inside the F-Motion
  plugin. A social plugin listens to `reel_ready`.
- Immich, faces, people search, or selfie match inside the plugin. Gallery
  hosts keep that (see [`fotium-faces-ux.md`](./fotium-faces-ux.md)).
- Iframe of the F-Motion studio. Link-out `projectUrl` until session handoff
  exists.
- A second render pipeline or a vendored engine.
- Posting to social from F-Motion.

## Follow-up

Ship `fmotion` as an installable WordPress plugin: settings screen, media
library picker, import POST, notify REST, attachment sideload, and the
hooks above with one runnable test against a stub F-Motion API.
