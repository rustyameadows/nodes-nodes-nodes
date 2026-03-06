# Product Brief: Node Interface Demo

## Problem Statement
Creative workflows for image/video/text generation are fragmented across model tools and weak asset review interfaces. Users lose time jumping between providers, comparing outputs manually, and managing context across experiments.

## Product Vision
Ship a local-first, node-based generation app where one user can run multiple model providers from an infinite canvas, then review outputs in a fast comparison-oriented asset viewer.

## Target User (V1)
- Solo creator, technical artist, or prototyper running the app locally.
- Comfortable with model experimentation and iterative output review.
- Wants project isolation and quick switching between experiments.

## Primary Jobs To Be Done
1. Create and switch between projects without cross-project data leakage.
2. Build generation flows on an infinite canvas.
3. Run nodes against multiple providers through a single interface.
4. Compare outputs quickly, then curate the best results using ratings, flags, and filters.

## Core User Flows
1. Create Project -> Open Project -> Start Empty Canvas.
2. Double-click canvas -> choose insert action -> add model nodes, text notes, list nodes, text templates, or uploaded assets.
3. Connect nodes -> Configure settings -> Run graph.
4. Watch job progress -> Inspect outputs -> Save as assets.
5. Open asset viewer -> switch Grid / 2-up / 4-up -> rate/flag/filter.
6. Switch to another project -> reopen later with preserved canvas and viewer state.

## Differentiators
- Provider-agnostic node system with equal treatment of OpenAI, Gemini (`Nano Banana 2` display name), and Topaz.
- Project-first local workflow with one infinite canvas per project.
- Lightroom-style review surface focused on side-by-side quality judgment, not just gallery browsing.

## V1 Scope
- Single local user.
- Project lifecycle: create, rename, archive, unarchive, delete.
- One open project workspace at a time.
- One canvas per project.
- Canvas prompt-note nodes for writing reusable prompt text and connecting it visually to model nodes.
- Canvas list nodes plus text-template nodes for local mail-merge style text expansion into per-row prompt notes.
- Async job execution with durable queueing.
- Local filesystem-backed asset binaries and Postgres metadata.
- Asset viewer modes: grid, 2-up, 4-up.
- Curation controls: 1-5 stars, flagged state, tags, and filters.

## V1 Non-Goals
- User accounts and sign-in.
- Organizations and sharing permissions.
- Billing and usage metering.
- Realtime multi-user collaboration.
- Cloud-first deployment hardening.

## Success Criteria
- User can create at least 3 projects and switch among them with state preserved.
- Jobs survive app restart and continue or recover cleanly.
- Provider nodes can run on all three initial providers via one contract.
- Asset viewer supports grid, 2-up, and 4-up with responsive performance for typical local datasets.
- Rating/flag/filter workflows produce deterministic, predictable result sets.

## Risks and Mitigations
- Provider API drift:
  - Mitigation: strict adapter boundary + model registry metadata.
- Long-running or failed jobs:
  - Mitigation: durable queue with retries, cancellation, and explicit failure reasons.
- Asset storage growth:
  - Mitigation: archive/delete tooling and configurable local storage root.
- Scope creep into multitenancy:
  - Mitigation: explicitly deferred in [FUTURE_MULTITENANCY.md](./FUTURE_MULTITENANCY.md).

## Related Docs
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DATA_MODEL.md](./DATA_MODEL.md)
- [PROVIDER_INTEGRATIONS.md](./PROVIDER_INTEGRATIONS.md)
- [UX_CANVAS_AND_ASSETS.md](./UX_CANVAS_AND_ASSETS.md)
- [PROJECTS_AND_WORKSPACE.md](./PROJECTS_AND_WORKSPACE.md)
- [ROADMAP.md](./ROADMAP.md)
