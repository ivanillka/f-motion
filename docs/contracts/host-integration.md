# Host integration

F-Engine owns versioned wire contracts and deterministic reel behavior. A host
owns identity, UI, authentication, persistence, providers, secrets,
infrastructure, customer data, and operational policy.

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

The reference worker reads `RENDER_WIDTH` and `RENDER_HEIGHT`, defaulting to
720×1280, plus optional `RENDER_WATERMARK`. A private host supplies its own
values from protected configuration.

Private hosts pin a reviewed F-Engine version and use a thin adapter around its
public package/API boundary. They must not patch or vendor a fork. Shared bugs
are reduced to neutral fixtures, fixed upstream, released, and then consumed
through a pin update.

Provider adapters stay in the host. No engine API receives credentials,
account objects, database handles, provider SDK clients, or branding bundles.
