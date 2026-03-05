# Roadmap

## Milestone 0: Documentation Baseline (Current)
- Deliverables:
  - `AGENTS.md`
  - Full docs set in `docs/`
  - Initial decision log
- Exit criteria:
  - Architecture and scope are implementation-ready.
  - No unresolved contradictions across docs.

## Milestone 1: Local App Foundation
- Deliverables:
  - Next.js + TypeScript app scaffold.
  - Local Postgres + Prisma setup.
  - `pg-boss` worker scaffold.
  - Local filesystem storage adapter scaffold.
- Exit criteria:
  - App boots locally with DB connectivity.
  - Worker can receive and complete a mock job.

## Milestone 2: Project and Workspace Core
- Deliverables:
  - Project CRUD (create/rename/archive/unarchive/delete).
  - Sidebar switching and one-open-project behavior.
  - Workspace restore on startup.
- Exit criteria:
  - Multiple projects can be managed and switched reliably.
  - Project isolation validated for canvas/jobs/assets.

## Milestone 3: Canvas and Execution Pipeline
- Deliverables:
  - TLDraw-based infinite canvas.
  - Node/edge persistence per project.
  - Job lifecycle wiring (`queued` -> `running` -> terminal states).
- Exit criteria:
  - User can construct and run simple node flows.
  - Job state updates appear in UI.

## Milestone 4: Provider Integrations (Concrete)
- Deliverables:
  - OpenAI adapter.
  - Gemini 3.1 Flash adapter with UI display name `Nano Banana 2`.
  - Topaz adapter.
  - Model registry and capability mapping.
- Exit criteria:
  - Same node contract works across all three providers.
  - Normalized outputs stored as assets.

## Milestone 5: Asset Viewer Differentiator
- Deliverables:
  - Grid mode with density controls.
  - 2-up and 4-up comparison modes.
  - Rating, flagging, tagging, filtering, and sorting.
- Exit criteria:
  - Curation workflow is fast and deterministic.
  - Compare mode and filter state persist per project.

## Milestone 6: Hardening and Packaging
- Deliverables:
  - Improved error handling and recovery.
  - Test coverage for project lifecycle, queue behavior, and provider parity.
  - Local dev onboarding docs and scripts.
- Exit criteria:
  - Clean local install and reliable end-to-end demo flow.

## Milestone 7: Multitenancy Expansion (Deferred)
- Deliverables:
  - User accounts.
  - Org/project sharing model.
  - Migration from single-user local ownership.
- Exit criteria:
  - Existing local projects migrate safely.
  - Permission model verified against collaboration scenarios.
