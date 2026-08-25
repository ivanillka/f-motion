# Host integration

F-Engine owns versioned wire contracts and deterministic reel behavior. A host
owns identity, UI, authentication, persistence, providers, secrets,
infrastructure, customer data, and operational policy.

Partner import (Fotium and the next CMS), Edit-in-F-Motion, and the return
webhook contract: [`partner-import.md`](./partner-import.md).  
Agent compose (media-first or chat-only → preview + draft):
[`agent-compose.md`](./agent-compose.md).  
Recipes: [`../agents/host-recipes.md`](../agents/host-recipes.md).  
Fotium faces/Immich UX (host-owned): [`fotium-faces-ux.md`](./fotium-faces-ux.md).

The host must supply a `RenderProfile`:

```ts
{
  width: 720,
  height: 1280,
  watermark: "Optional host-owned label"
}
```

Width and height are integers from 16 through 7680. A watermark is optional;
when present it is already trimmed and at most 120 characters. Invalid
profiles fail before FFmpeg arguments are created.

The admitting API owns two profiles. `PREVIEW_RENDER_WIDTH` and
`PREVIEW_RENDER_HEIGHT` default to 540×960; `RENDER_WIDTH` and `RENDER_HEIGHT`
default to 1080×1920. Each supports an optional matching `_WATERMARK`. The API
validates and snapshots the selected profile with the immutable job. The worker
revalidates that stored profile and never reads current profile environment
values, so retries cannot silently change dimensions or watermark.

Private hosts pin a reviewed F-Engine version and use a thin adapter around its
public package/API boundary. They must not patch or vendor a fork. Shared bugs
are reduced to neutral fixtures, fixed upstream, released, and then consumed
through a pin update.

Provider adapters stay in the host. No engine API receives credentials,
account objects, database handles, provider SDK clients, or branding bundles.
