# F-Motion skill distribution project

This is the tracking project for every place the F-Motion skill or its
machine tools can be installed. **Canonical files:**
`skills/fmotion/SKILL.md` and `skills/fmotion/sources.json`.

Do not create a second copy of the compose rules. When the loop changes, bump
`version` in both files and walk every source whose `status` is not `pending`.

`sources.json` is the checklist an agent or CI can read. This file is the
runbook.

## Sources

| id | Listing | Status | How it stays current |
|---|---|---|---|
| `repo` | GitHub `skills/fmotion` | live | Source of truth |
| `clawhub` | [ClawHub](https://clawhub.ai) slug `fmotion` | ready to publish | CLI or the workflow below |
| `skills-sh` | skills.sh / ClawHub search | follows ClawHub | Confirm search after each release |
| `clawhub-github-import` | clawhub.ai GitHub importer | pending | Needs a public repo the signed-in owner can scan |
| `openclaw-docs` | `docs/agents/openclaw/README.md` | live | Keep HTTP schemas in sync |
| `cursor-repo` | Cursor Agent Skills in this repo | live | Same `SKILL.md` |
| `cursor-marketplace` | cursor.com/marketplace | pending | Needs a plugin manifest; paste URL when listed |
| `cursor-directory` | cursor.directory/plugins/new | pending | Submit the GitHub repo URL; paste listing URL |
| `hermes-mcp` | `@f-engine/fmotion-mcp` | live | Tool names must match the skill |
| `npm-packages` | public npm CLI/MCP | pending | Packages are still private |
| `website` | [f-motion.com/agents.html](https://f-motion.com/agents.html) | live | Keep copy + visuals with SKILL.md |
| `linkedin` | Company page | ready to publish | `docs/linkedin/posts/` — company page only |

Statuses: `live` · `ready_to_publish` · `follows_clawhub` · `pending`.

A `live` or `ready_to_publish` row is dirty when `published_version` is missing
or does not match `sources.json` `version` (MCP/npm may track their own package
version).

## Publish to ClawHub

Needs a ClawHub account that can publish. Store `CLAWHUB_TOKEN` only in host
secrets, never in the repo or in chat.

```bash
npx clawhub@latest login
npx clawhub@latest skill publish ./skills/fmotion \
  --slug fmotion \
  --name "F-Motion" \
  --categories creative \
  --topics "video,reel,storyboard" \
  --source-repo ivanillka/f-motion \
  --source-path skills/fmotion \
  --source-commit "$(git rev-parse HEAD)" \
  --changelog "Compose loop: media or chat, preview + draft." \
  --dry-run
```

Drop `--dry-run` for the real release. First publish becomes `1.0.0`; later
file changes publish the next patch unless you pass `--version`.

GitHub Action: **Publish F-Motion skill** (`workflow_dispatch`). Default is
dry-run. Set repository secret `CLAWHUB_TOKEN`. Optional `CLAWHUB_OWNER` if
publishing under an org handle.

After a live publish:

1. Set `clawhub.status` to `live`, set `published_version`, and keep the public
   skill URL in `sources.json`.
2. Search ClawHub and skills.sh for `fmotion`.
3. Install once: `npx clawhub@latest install fmotion` (or
   `openclaw skills install fmotion`).

ClawHub licenses published skills as **MIT-0**. This repository remains
Apache-2.0. Do not add a conflicting license block to `SKILL.md`.

## Other platforms

- **OpenClaw host without ClawHub:** point the gateway at this skill folder, or
  install from ClawHub once it is live. Still use an F-Motion owner key, not
  the gateway token.
- **Cursor:** opening this repo loads `skills/fmotion`. Public marketplace and
  cursor.directory stay `pending` until someone submits the form and records
  the listing URL.
- **Hermes / any MCP host:** `docs/agents/getting-started.md` — not a second
  skill text. Public `npx fmotion-mcp` waits on the npm packages row.

## Review cadence

When `skills/fmotion/SKILL.md` changes, treat every `live` or
`ready_to_publish` row as dirty until `sources.json` `version` matches and the
listing was republished or confirmed unchanged.
