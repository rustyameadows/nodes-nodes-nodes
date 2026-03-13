# Node Interface Demo: Agent Guide

## Start Here
- Product goals: [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md)
- System architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Data model and persistence: [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- Provider contracts: [docs/PROVIDER_INTEGRATIONS.md](docs/PROVIDER_INTEGRATIONS.md)
- Canvas and asset UX: [docs/UX_CANVAS_AND_ASSETS.md](docs/UX_CANVAS_AND_ASSETS.md)
- Project lifecycle and workspace behavior: [docs/PROJECTS_AND_WORKSPACE.md](docs/PROJECTS_AND_WORKSPACE.md)
- Delivery plan: [docs/ROADMAP.md](docs/ROADMAP.md)
- Architecture decisions log: [docs/DECISIONS.md](docs/DECISIONS.md)
- Testing protocol: [docs/TESTING_PROTOCOL.md](docs/TESTING_PROTOCOL.md)
- Deferred multitenancy design: [docs/FUTURE_MULTITENANCY.md](docs/FUTURE_MULTITENANCY.md)

## Mission
Build a local-first Next.js app for node-based media generation and post-processing. The first milestone targets a single local user with multiple projects, one infinite canvas per project, and a fast asset comparison workflow.

## Product Boundaries (Round 1)
- In scope:
  - Local project creation and switching.
  - Infinite canvas workflow with provider-agnostic nodes.
  - Provider integrations for OpenAI, Gemini 3.1 Flash (display name `Nano Banana 2`), and Topaz.
  - Async generation jobs with durable queueing.
  - Asset viewer with grid, 2-up, 4-up, rating, flagging, and filtering.
- Out of scope:
  - User accounts, orgs, and project sharing.
  - Hosted deployment hardening.
  - Billing, usage metering, and subscription controls.

## Engineering Guardrails
- Local-first by default. The app must run on one machine with local services.
- Keep provider integration pluggable and model IDs stable.
- Store metadata in Postgres and generated binaries on filesystem via adapter.
- Maintain one open project workspace at a time in v1.
- Favor explicit typed contracts between canvas nodes, jobs, assets, and providers.
- Preserve deterministic behavior for project switching, job state transitions, and asset filtering.

## Paper Safety Rules
- Never delete anything from Paper.
- Never delete, remove, or replace an artboard in Paper, even if the agent created it earlier in the session.
- Treat all existing Paper artboards and nodes as user-owned unless the user explicitly asks to edit that exact artifact.
- When the user asks for a new Paper artifact, create a new artboard from scratch instead of duplicating or modifying an existing one.
- When a Paper design needs revision, duplicate, rename, or create a new artboard/node instead of deleting an existing one.
- If an incorrect Paper artifact is created, leave it in place and add the corrected version separately.

## Documentation Governance
- Docs are code. Any behavior/interface/schema change must include doc updates in the same PR.
- Add dated entries to [docs/DECISIONS.md](docs/DECISIONS.md) for non-trivial product or architecture decisions.
- Keep [docs/ROADMAP.md](docs/ROADMAP.md) accurate at milestone boundaries.
- Use stable terms from this guide in all docs and code comments.

## Documentation Update Matrix
| Change Type | Required Doc Updates |
| --- | --- |
| Project lifecycle, open/close/switch logic | [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md), [docs/PROJECTS_AND_WORKSPACE.md](docs/PROJECTS_AND_WORKSPACE.md), [docs/UX_CANVAS_AND_ASSETS.md](docs/UX_CANVAS_AND_ASSETS.md) |
| Schema/table/type updates | [docs/DATA_MODEL.md](docs/DATA_MODEL.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) |
| Provider/model capability changes | [docs/PROVIDER_INTEGRATIONS.md](docs/PROVIDER_INTEGRATIONS.md), [docs/UX_CANVAS_AND_ASSETS.md](docs/UX_CANVAS_AND_ASSETS.md), [docs/DECISIONS.md](docs/DECISIONS.md) |
| Queue/execution lifecycle changes | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md), [docs/PROVIDER_INTEGRATIONS.md](docs/PROVIDER_INTEGRATIONS.md) |
| Asset viewer interactions and filtering logic | [docs/UX_CANVAS_AND_ASSETS.md](docs/UX_CANVAS_AND_ASSETS.md), [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md) |
| Scope or milestone shifts | [docs/ROADMAP.md](docs/ROADMAP.md), [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md), [docs/DECISIONS.md](docs/DECISIONS.md) |
| Future multitenancy decisions | [docs/FUTURE_MULTITENANCY.md](docs/FUTURE_MULTITENANCY.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/DECISIONS.md](docs/DECISIONS.md) |

## Canonical Terms
- Project: top-level unit of work, isolated from other projects.
- Workspace: active UI context for exactly one open project.
- Canvas: infinite node graph document belonging to one project.
- Job: async execution unit produced from node runs.
- Asset: persisted output from jobs (image/video/text) with metadata for review and filtering.
- Provider Adapter: implementation of the common provider interface for a model platform.

## Definition of Done for Feature PRs
- Feature behavior implemented and tested.
- Interfaces/types reflected in docs.
- Decision recorded when architecture or product direction changed.
- No stale contradictions across docs.
- UI-impacting changes verified in-browser via Chrome MCP before handoff.
- For UI or visual polish changes, do not claim completion until you have personally reviewed fresh screenshots or live Chrome MCP output from the changed surface. If the user is asking about layout/styling, include those screenshots in the handoff.
- When presenting completed work to the user for repo code changes or app-behavior changes, build a fresh mac app artifact with `npm run package:mac` and report the resulting `.app` and `.zip` paths in the handoff.
- Do not run `npm run package:mac` for Paper MCP-only work, design-only tasks, copy-only tasks, or other requests that do not change the app code in this repository.
- Always include screenshots relevant to the feature being presented in the handoff, even when not explicitly requested.
- In screenshot handoff notes, include a direct markdown image link (`![description](artifact_path)`) and 1-2 bullets describing exactly what the user should verify in that image.
- Feature screenshots must show the actual surface changed (for example: the edited node/component in its active state), not a generic home or landing view.
