# Decisions Log

## 2026-03-04 - Local-First Architecture
- Decision: prioritize local runtime over hosted-first design.
- Rationale: optimize iteration speed and developer onboarding for demo quality.
- Consequence: local Postgres and filesystem storage are first-class from day one.

## 2026-03-04 - V1 Scope Is Single User
- Decision: defer accounts, orgs, and sharing.
- Rationale: focus on product core loop (project -> canvas -> generation -> asset curation).
- Consequence: ownership and permissions are intentionally absent in initial schema.

## 2026-03-04 - Projects Are First-Class in V1
- Decision: support multiple local projects with one open workspace at a time.
- Rationale: users need isolated experiments and rapid switching.
- Consequence: explicit project lifecycle and workspace persistence required.

## 2026-03-04 - One Canvas per Project (V1)
- Decision: constrain each project to exactly one infinite canvas initially.
- Rationale: reduces complexity while preserving project isolation.
- Consequence: future multi-canvas support will require schema and UX expansion.

## 2026-03-04 - Provider-Agnostic Node System
- Decision: all provider nodes share one contract and equal treatment.
- Rationale: avoid provider lock-in and simplify expansion.
- Consequence: provider adapters must normalize request/response behavior.

## 2026-03-04 - Canonical Provider Set
- Decision: include OpenAI, Gemini 3.1 Flash, and Topaz in v1 docs.
- Rationale: cover text/image/video generation and enhancement scenarios.
- Consequence: model registry must map stable IDs to mutable display names.

## 2026-03-04 - Gemini Display Name Override
- Decision: expose Gemini 3.1 Flash as `Nano Banana 2` in UI.
- Rationale: product language can differ from backend model IDs.
- Consequence: display labels are lookup-driven, never persisted as primary IDs.

## 2026-03-04 - Queue Backend Is Postgres (`pg-boss`)
- Decision: use `pg-boss` for async orchestration.
- Rationale: same backend works locally and in deployment with Postgres.
- Consequence: no Redis dependency in v1.

## 2026-03-04 - Storage Adapter Uses Local Filesystem in V1
- Decision: generated binaries are stored on disk behind a storage abstraction.
- Rationale: simple local-first behavior with easy migration path later.
- Consequence: object storage adapter can be introduced without rewriting business logic.

## 2026-03-05 - Provider Calls Stubbed for Milestone Implementation
- Decision: keep OpenAI/Gemini/Topaz adapters concrete at the contract level but return deterministic stub outputs until keys are available.
- Rationale: unblock full local implementation through Milestone 5 without waiting on API credentials.
- Consequence: provider wiring, queueing, and asset pipelines are testable now; swapping to real API calls later only changes adapter internals.

## 2026-03-05 - Inline Execution Default with Queue Mode Option
- Decision: default `JOB_EXECUTION_MODE=inline` while preserving a `queue` mode that uses `pg-boss` worker processes.
- Rationale: simplest local run path for new contributors while keeping production-compatible queue architecture.
- Consequence: single-process local demos work out of the box; queue mode can be enabled without code changes.

## 2026-03-05 - Replace TLDraw with Custom Canvas UI
- Decision: remove TLDraw and use a custom React infinite canvas so layout and interaction design are fully controlled in-app.
- Rationale: product direction requires tighter visual control and a full-viewport workspace with floating overlays.
- Consequence: canvas behavior is now owned in local components (pan/zoom/node drag/drop/settings chrome), with project-persisted viewport and node coordinates.

## 2026-03-05 - OpenAI Is the First Real Provider Path
- Decision: make `openai / gpt-image-1.5` the only live provider execution path for now, and keep Gemini/Topaz plus other OpenAI models visible as `Coming soon`.
- Rationale: ship a real end-to-end prompt-note + image-reference generation loop without pretending the rest of the provider catalog is production-ready.
- Consequence: UI gating now comes from provider-model capability metadata, job payloads snapshot resolved prompt/image inputs, and generated OpenAI outputs are materialized back onto the canvas as image nodes.

## 2026-03-05 - OpenAI Infers Generate vs Edit from Connected Inputs
- Decision: remove the explicit `generate` / `edit` control from the `gpt-image-1.5` node UI, infer the execution mode from whether supported image inputs are connected, and keep runtime job-state visibility on the immediately-created generated output node.
- Rationale: users think in terms of prompt-only vs reference-image generation, not OpenAI endpoint names. The manual toggle adds API vocabulary without adding product value.
- Consequence: queued job payloads still snapshot `executionMode`, but the client derives it automatically from resolved image inputs, generated nodes retain `sourceJobId` plus inline source-call inspection, and model nodes stay focused on prompt/input wiring instead of transport details.

## 2026-03-05 - Model Parameters Are Schema-Driven and GPT Image 1.5 Uses the Fuller Images API Surface
- Decision: move model controls to declarative provider metadata and expose GPT Image 1.5 aspect ratio, resolution, transparency, format, output count, and advanced controls from that schema.
- Rationale: future model expansion should not require hard-coded settings-surface rewrites, and GPT Image 1.5 needs more of its real Images API surface than a fixed square/medium default.
- Consequence: provider capabilities now include parameter definitions, OpenAI defaults shift to `auto` where supported, generated outputs can fan out to multiple placeholders, and generated assets persist `outputIndex` so canvas reconciliation remains deterministic.

## 2026-03-05 - Asset Nodes Are Peer Pointers and OpenAI Previews Are Durable
- Decision: allow multiple canvas asset-source nodes to point at the same uploaded/generated asset, and persist streamed GPT Image 1.5 partial previews as separate durable job-preview records instead of normal assets.
- Rationale: users need to reuse previous outputs/uploads freely on canvas without duplicating binaries, and progressive previews must survive refresh while remaining outside the review library.
- Consequence: the insert picker now includes generated/uploaded asset library actions, generated pointer nodes retain source-call access through shared asset/job metadata, and `job_preview_frames` back the running-node preview UI until final assets are persisted.

## 2026-03-05 - Canvas Wiring and Node Chrome Encode Media Semantics
- Decision: make canvas visuals communicate media type and generation state directly through connection colors, semantic border treatments, and generated-image placeholder shells instead of generic provider styling.
- Rationale: the canvas is a composition tool first, so users need to read prompt/image/video flow and in-progress outputs at a glance without opening secondary chrome.
- Consequence: prompt/text lines are solid neon pink, image lines are neon blue, video lines are neon orange, model output nipples and model-to-generated-output edges use citrus, generated output nodes reserve their final frame shape immediately, and image nodes use flatter image-first chrome with minimal overlay copy.

## 2026-03-06 - Replace the Draggable Node Modal with a Bottom Settings Bar
- Decision: move single-node configuration and compare actions into one fixed full-width bottom bar, keep the bar mounted in an empty state, and move the queue pill to the top-right.
- Rationale: the canvas should keep its chrome short and consistent, with settings, compare actions, and image viewing accessible from one predictable edge instead of splitting interaction between a selection bar and a draggable modal.
- Consequence: the floating upload CTA is removed, upload remains available from the insert menu, core node controls stay inline in the bar, and verbose content now opens in upward trays/popovers from that bar.
