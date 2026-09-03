# F-Engine publication boundary

Decision date: 2026-07-30  
Approver: project maintainer

| Decision | Approved value |
|---|---|
| Public name | F-Engine; repository slug `f-engine` |
| Package name | Private workspace packages initially; no registry publication |
| License | Apache-2.0 |
| Copyright holder | Privately owned by the maintainer; identity intentionally omitted from the public distribution |
| Security contact | GitHub Private Vulnerability Reporting; it must be enabled before publication |
| Contributions | Outside contributions are not accepted initially |
| Rights owner | Maintainer confirms ownership or redistribution permission for every path classified public |

The canonical Apache-2.0 license text is included once at the distribution
root. Public files use SPDX package metadata where applicable. No personal
copyright notice is published, and no fictitious owner is substituted.

## One-way ownership

F-Engine is the upstream for neutral, deterministic reel behavior. A shared
fix is made and tested upstream, released with SemVer when registry publication
is later approved, and then pinned by a private host.

Each private product host owns its branding, product UI and copy,
authentication and accounts, customer data, databases, deployment, provider
credentials and adapters, commercial policy, and operations. It may implement
a thin adapter to stable F-Engine APIs, but it must never patch a vendored or
forked engine copy.

There is no sharing of databases, accounts, credentials, deployment state, or
customer data. Public Git visibility does not enable hosted signup or provider
spend.

A public release is produced from an allowlisted clean snapshot and a fresh
root commit. Existing private history is never pushed, copied, or rewritten
for publication.

The fix flow is:

1. Reduce a shared engine bug to a neutral regression.
2. Fix and verify it in F-Engine.
3. Release a reviewed version.
4. Update the exact private-host pin.

A private product bug remains private unless it can be reduced to that neutral
engine boundary.

## Path ownership

| Area | Classification | Reason |
|---|---|---|
| `packages/contracts/**`, `packages/reel-engine/**` | public after neutralization | Neutral shared contracts and deterministic behavior |
| Reference renderer under `apps/worker/**` | public after neutralization | Deterministic reference renderer |
| Generic reference API and web client | public after neutralization | Executable verification host without production identity |
| `docs/contracts/**` | public after neutralization | Host integration contract |
| `DESIGN.md`, `docs/design/**`, `spikes/**` | private | Product identity, references, and generated evidence |
| `apps/mobile/**` | private | Product-specific application surface |
| `deploy/**`, hosted runbooks, Pages functions, real environment values | private | Deployment topology and identifiers |
| Credentials, certificates, private keys, dumps, backups, downloads, customer data | forbidden | Secrets or personal/customer data must never be exported |
| `plans/**` | private | Internal execution history and product strategy |

Provider implementations belong to a reference host, not the deterministic
engine. Opening a provider adapter requires a separate ownership and security
decision.

## Release gates

All gates must pass for one committed full SHA:

1. Every tracked path has exactly one reviewed classification.
2. Only `public` paths are exported into a new empty directory.
3. The candidate checker finds no private path, identity marker, credential
   marker, unsafe symlink, or binary-path violation.
4. A separately approved, pinned secret scanner reports no findings.
5. GitHub Private Vulnerability Reporting is enabled.
6. Normal lint, test, build, package-consumer, and publication-tool checks pass.
7. A reviewer confirms the candidate contains no private Git history.

No tool in this repository creates a remote, changes visibility, publishes a
package, or deploys a service.
