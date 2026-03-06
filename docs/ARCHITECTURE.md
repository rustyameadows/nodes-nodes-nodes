# Architecture (V1 Local-First)

## Stack
- Framework: Next.js (App Router) + TypeScript.
- Database: local Postgres.
- ORM: Prisma.
- Queue: `pg-boss` on the same Postgres instance.
- Canvas: custom React infinite canvas engine (pan/zoom + draggable nodes).
- Asset binary storage: local filesystem through a storage adapter.

## Runtime Topology
1. Next.js web app provides UI and API route handlers.
2. Postgres stores project, canvas, job, and asset metadata.
3. Postgres also stores transient `job_preview_frames` for in-progress streamed images.
4. Jobs run inline by default (`JOB_EXECUTION_MODE=inline`) and can also run through `pg-boss`.
5. Filesystem storage adapter persists uploaded/generated binaries plus transient streamed preview frames.
6. Provider adapters normalize OpenAI Images, OpenAI Responses text generation, and Topaz behavior behind the same contract while Gemini remains placeholder-only.

## Core Modules
- `ProjectService`: project lifecycle and active project switching.
- `WorkspaceService`: tracks open project, viewport, and viewer layout state.
- `CanvasService`: manages node/edge document versioning.
- `JobService`: enqueues, tracks, retries, and cancels execution.
- `AssetService`: persists asset metadata and curation state.
- `ProviderRegistry`: resolves provider/model capabilities and display names.
- `StorageAdapter`: writes and resolves local binary files.
- Canvas client persistence is hydration-gated: no canvas `PUT` is allowed until the initial project canvas document has been fetched and applied locally.

## Data Flow: Node Execution
1. User triggers graph run from active project canvas.
2. Canvas client resolves the actual run snapshot before enqueue:
  - connected text note content becomes `nodePayload.prompt` when present
  - model prompt field is fallback when no text note is connected
  - OpenAI image execution mode is inferred from connected image inputs and snapshotted as `nodePayload.executionMode`
  - OpenAI GPT text models always run in `generate` mode and accept prompt text only
  - Topaz Image API runs stay in `edit` mode and require exactly one connected image input
  - schema-driven model parameters are resolved to effective provider settings before enqueue
  - requested OpenAI image output count is snapshotted as `nodePayload.outputCount`; GPT text and Topaz remain fixed at one output
  - connected image inputs resolve to concrete asset IDs and are capped to the image-model limit
3. API validates the resolved payload and creates a `job` record.
4. Canvas client inserts output placeholders immediately after job creation:
  - image and Topaz jobs create `asset-source` placeholder nodes
  - GPT text jobs create generated `text-note` placeholder nodes
  - each placeholder stores the originating `jobId` plus `outputIndex`
5. Inline executor or `pg-boss` worker loads referenced asset bytes from local storage and invokes the provider adapter.
6. OpenAI image runs stream partial images; the processor persists them as durable preview-frame records keyed by `(jobId, outputIndex, previewIndex)`.
7. OpenAI GPT text runs use `client.responses.create(...)` and finish as one normalized text output without token streaming in v1.
8. Topaz Image API runs use provider-native transport:
  - `high_fidelity_v2` is synchronous and returns one output image directly from `/image/v1/enhance`
  - `redefine` is asynchronous, polls status, downloads the final output, then ingests that file back into normal asset storage
9. Adapter returns normalized final outputs, including binary image buffers for generated images and inline text for GPT note outputs.
10. Storage adapter writes final binaries to disk only for non-text outputs; DB stores metadata + storage ref + output ordering for generated visual variants.
11. UI polls job updates and reconciles output nodes by `(jobId, outputIndex)`:
  - `queued` -> `running`
  - `running` nodes render the latest streamed preview frame when available
  - `running/queued` -> `failed` keeps the placeholder
  - `succeeded` image nodes attach the final asset and clear the processing badge
  - `succeeded` GPT text nodes hydrate the note body from `latestTextOutputs` and clear the processing badge
12. When image assets are missing persisted width/height metadata, the server recovers dimensions from the binary file bytes before provider execution or viewer display.

## Data Flow: Template Text Generation
1. User triggers `Generate Rows` from a `text-template` node on the active canvas.
2. Canvas client resolves the connected `list` node locally:
  - requires exactly one connected list
  - normalizes column labels by trim + whitespace collapse + case fold
  - validates unique/non-empty column labels and placeholder coverage
  - skips fully blank rows and substitutes blank cells with empty strings
3. Client creates a new batch id and materializes one new text-note node per nonblank row directly in canvas state.
4. Generated notes persist the source template/list/batch/row metadata inside node settings and remain editable prompt-source nodes for downstream model runs.
5. No `job`, `asset`, `job_preview_frames`, provider adapter, or queue path is involved in this flow.

## Canvas Graph Semantics
- Wire creation can start from either port.
- Dragging from an input to an output is normalized into the same persisted `source -> target` relationship as output-to-input wiring.
- Prompt-note connections are stored separately from standard upstream media inputs:
  - text note -> model sets `promptSourceNodeId`
  - media/image inputs accumulate in `upstreamNodeIds`
- List-template connections use standard upstream node relationships:
  - list -> text-template stores the list node id in `upstreamNodeIds`
  - text-template nodes do not emit prompt-source links directly; their generated text-note outputs do
- GPT text model nodes are input-only in the graph:
  - prompt chaining happens through their generated `text-note` outputs, not through a model output connection
- Asset-source nodes are peer pointers to one `asset` record:
  - uploaded asset pointers resolve `jobId = null`
  - generated asset pointers resolve `jobId != null`
  - multiple canvas nodes may point at the same asset without duplication

## Project Switching Behavior
1. Only one project workspace can be open at once.
2. Switching project closes current workspace context.
3. Opened project restores:
  - canvas viewport
  - current selection (if valid)
  - asset viewer layout and filters
4. Last-opened project is restored on app launch.

## Provider Abstraction
- Providers are equal participants in the node system.
- Provider/model IDs are internal and stable.
- UI display names are configurable and may differ from IDs.
- Gemini 3.1 Flash is displayed as `Nano Banana 2`.
- Current runtime status:
  - `openai / gpt-image-1.5` and `openai / gpt-image-1-mini`: real execution paths for prompt-only generation and image edit/reference flow
  - `openai / gpt-5.4`, `openai / gpt-5-mini`, `openai / gpt-5-nano`: real Responses-API text-generation paths that materialize canvas notes instead of assets
  - `topaz / high_fidelity_v2` and `topaz / redefine`: real Topaz Image API execution paths
  - other OpenAI models and Gemini: visible in model pickers as `Coming soon`, not runnable

## Configuration (Expected Env Vars)
```bash
DATABASE_URL=postgresql://...
PG_BOSS_SCHEMA=pgboss
JOB_EXECUTION_MODE=inline
ASSET_STORAGE_ROOT=./.local-assets
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

`OPENAI_API_KEY` is only required when you want to run real OpenAI generations. `TOPAZ_API_KEY` is only required when you want to run real Topaz transforms. The rest of the local app boots without either.

## Error and Recovery Strategy
- Queue retry policy with bounded attempts and exponential backoff.
- Explicit job states and failure codes for UI visibility (`CONFIG_ERROR`, `COMING_SOON`, `INVALID_INPUT`, `PROVIDER_ERROR`).
- Idempotency key on job submissions to avoid duplicate execution.
- Storage write failures mark job failed with structured reason.
- On restart, worker resumes uncompleted queue items.

## Deployment Compatibility
V1 is local-first, but architecture keeps deployment options open by preserving:
- Postgres-backed metadata and queueing.
- Adapter-based binary storage.
- Provider adapters isolated from UI and persistence details.
