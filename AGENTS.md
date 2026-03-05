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
