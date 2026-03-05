# Architecture (V1 Local-First)

## Stack
- Framework: Next.js (App Router) + TypeScript.
- Database: local Postgres.
- ORM: Prisma.
- Queue: `pg-boss` on the same Postgres instance.
- Canvas: TLDraw.
- Asset binary storage: local filesystem through a storage adapter.

## Runtime Topology
1. Next.js web app provides UI and API route handlers.
2. Postgres stores project, canvas, job, and asset metadata.
3. `pg-boss` worker processes queued jobs and calls provider APIs.
4. Filesystem storage adapter persists generated binaries.
5. Provider adapters normalize OpenAI, Gemini, and Topaz behavior.

## Core Modules
- `ProjectService`: project lifecycle and active project switching.
- `WorkspaceService`: tracks open project, viewport, and viewer layout state.
- `CanvasService`: manages node/edge document versioning.
- `JobService`: enqueues, tracks, retries, and cancels execution.
- `AssetService`: persists asset metadata and curation state.
- `ProviderRegistry`: resolves provider/model capabilities and display names.
- `StorageAdapter`: writes and resolves local binary files.

## Data Flow: Node Execution
1. User triggers graph run from active project canvas.
2. API validates graph inputs and creates a `job` record.
3. API enqueues provider execution work into `pg-boss`.
4. Worker pulls queue job, invokes adapter, and records attempts.
5. Worker normalizes provider outputs into canonical asset records.
6. Storage adapter writes binaries to disk; DB stores metadata + storage ref.
7. UI polls or subscribes to job updates and refreshes canvas/asset panels.

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

## Configuration (Expected Env Vars)
```bash
DATABASE_URL=postgresql://...
PG_BOSS_SCHEMA=pgboss
ASSET_STORAGE_ROOT=./.local-assets
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

## Error and Recovery Strategy
- Queue retry policy with bounded attempts and exponential backoff.
- Explicit job states and failure codes for UI visibility.
- Idempotency key on job submissions to avoid duplicate execution.
- Storage write failures mark job failed with structured reason.
- On restart, worker resumes uncompleted queue items.

## Deployment Compatibility
V1 is local-first, but architecture keeps deployment options open by preserving:
- Postgres-backed metadata and queueing.
- Adapter-based binary storage.
- Provider adapters isolated from UI and persistence details.
