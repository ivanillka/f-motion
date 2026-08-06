# OpenClaw + F-Motion

Call F-Motion over `/v1` with an **F-Motion owner API key**. Do not use the OpenClaw Gateway operator bearer as F-Motion authentication, and do not embed secrets in a shared gateway token.

## Setup

1. Sign in on the F-Motion web app.
2. Open **Settings → Machine API keys** and create a key (secret shown once).
3. Store the key in the skill/tool environment as `FMOTION_API_KEY` (and `FMOTION_API_ORIGIN`).

## Example function-tool schemas

```json
{
  "name": "fmotion_usage",
  "description": "Return remaining F-Motion host render_unit balance.",
  "parameters": { "type": "object", "properties": {} }
}
```

```json
{
  "name": "fmotion_create_project",
  "description": "Create a project from a purpose brief.",
  "parameters": {
    "type": "object",
    "required": ["purpose"],
    "properties": {
      "purpose": { "type": "string" },
      "audience": { "type": "string" },
      "tone": { "type": "string" }
    }
  }
}
```

```json
{
  "name": "fmotion_request_render",
  "description": "Queue preview|final render. May return quota_exceeded.",
  "parameters": {
    "type": "object",
    "required": ["project_id"],
    "properties": {
      "project_id": { "type": "string" },
      "kind": { "type": "string", "enum": ["preview", "final"] }
    }
  }
}
```

## Example tool implementation (HTTP)

```js
async function fmotionRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${process.env.FMOTION_API_ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.FMOTION_API_KEY}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(json.message || response.statusText);
    err.type = json.type;
    err.status = response.status;
    throw err;
  }
  return json;
}

export const tools = {
  fmotion_usage: () => fmotionRequest("/v1/me/usage"),
  fmotion_create_project: ({ purpose, audience, tone }) =>
    fmotionRequest("/v1/projects", { method: "POST", body: { purpose, audience, tone } }),
  fmotion_request_render: ({ project_id, kind = "preview" }) =>
    fmotionRequest(`/v1/projects/${project_id}/render`, { method: "POST", body: { kind } })
};
```

## Alternatives

- Shell out to `fmotion … --json` (same credentials file / env).
- Wrap `fmotion-mcp` if the OpenClaw host can attach stdio MCP servers.

## Non-goals

- Managed FAL / platform provider keys  
- Replacing Supabase web login  
- Forking the OpenClaw Gateway  
