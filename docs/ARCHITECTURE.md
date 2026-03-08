# Architecture (V1 Local-First Desktop)

## Stack
- Shell: Electron main + preload + worker.
- Renderer: Vite + React + TanStack Router + TanStack Query.
- Persistence: SQLite via Drizzle and `better-sqlite3`.
- Queue: durable SQLite-backed job polling in a dedicated worker process.
- Asset storage: local filesystem under the Electron app-data root.
- Canvas: custom React infinite canvas engine.

## Process Boundaries
1. `main`
   - owns app lifecycle, BrowserWindow creation, native dialogs, protocol registration, IPC registration, and worker supervision
2. `preload`
   - exposes the typed `window.nodeInterface` bridge
3. `renderer`
   - owns React UI only
   - cannot access Node APIs, filesystem paths, SQLite, or API keys directly
4. `worker`
   - polls the SQLite queue
   - claims jobs, heartbeats while running, calls provider adapters, persists preview frames and final outputs

## App Data Layout
- App data root: Electron `userData` plus `/node-interface-demo`
- SQLite file: `app.sqlite`
- Asset binaries: `assets/<projectId>/...`
- Preview frames: `previews/<jobId>/...`

The runtime also works outside Electron for tests and CLI builds by falling back to a repo-local `.local-desktop` folder.

## Core Services
- `projects`
  - create, list, rename, archive, delete, open
- `workspace`
  - load and save canvas/workspace snapshots
- `assets`
  - import, list, inspect, update curation metadata, resolve binary files
- `jobs`
  - validate submissions, create durable jobs, expose queue/debug state, handle stale-job recovery
- `providers`
  - sync provider-model metadata into SQLite and expose renderer-facing capability records
- `storage`
  - persist assets and preview frames under app data

## Renderer Contract
The renderer talks to the desktop runtime only through `window.nodeInterface`.

Available methods:
- `listProjects`, `createProject`, `updateProject`, `deleteProject`, `openProject`
- `getWorkspaceSnapshot`, `saveWorkspaceSnapshot`
- `listAssets`, `getAsset`, `updateAsset`, `importAssets`
- `listJobs`, `createJob`, `getJobDebug`
- `listProviders`
- `listProviderCredentials`, `saveProviderCredential`, `clearProviderCredential`
- `setMenuContext`
- `subscribe(eventName, listener)`
- `subscribeMenuCommand(listener)`

Available events:
- `projects.changed`
- `workspace.changed`
- `assets.changed`
- `jobs.changed`
- `providers.changed`

Native menu flow:
- renderer reports `{ projectId, view, hasProjects }` through `setMenuContext`
- main rebuilds the macOS app menu with project-aware enabled states and dynamic project submenus
- main emits native menu commands back to renderer through `subscribeMenuCommand`
- canvas-specific native menu commands are forwarded inside the renderer to `CanvasView`, which reuses the same insert helpers as the in-canvas insert popup

TanStack Query owns persisted app data in the renderer and is invalidated from those desktop events.

## Asset Delivery
- Assets and preview frames are served through the read-only `app-asset://` protocol.
- Examples:
  - `app-asset://asset/<assetId>`
  - `app-asset://preview/<previewFrameId>?ts=<createdAt>`
- The renderer never receives raw filesystem paths.

## Job Flow
1. Canvas resolves a concrete run request from the active graph.
2. Renderer submits `createJob(...)` through preload.
3. Main writes the `jobs` row to SQLite and emits `jobs.changed`.
4. Worker polls eligible `queued` jobs and atomically claims one.
5. Worker marks heartbeats while the provider call is running.
6. Provider adapter emits preview frames when supported.
7. Worker persists final outputs as assets or note-native text results.
8. Worker records attempt metadata, marks terminal job state, and emits `jobs.changed` plus `assets.changed` when needed.

## Queue Recovery
- Queue source of truth is the `jobs` table.
- Queue-specific fields:
  - `available_at`
  - `claimed_at`
  - `claim_token`
  - `last_heartbeat_at`
- On startup, stale running jobs are moved back to `queued`.
- Retry behavior uses bounded exponential backoff and persists every attempt in `job_attempts`.

## Startup Sequence
1. Electron main establishes the app-data root.
2. SQLite opens and bootstraps the schema if needed.
3. Provider-model metadata is synchronized into `provider_models`.
4. `app-asset://` is registered.
5. IPC handlers are registered.
6. Worker is spawned.
7. Renderer window is created and routed to the last-open project or launcher.

## Configuration
Provider credentials resolve in this order:
1. macOS Keychain values saved from Settings
2. environment variables from `.env` / `.env.local`

Required only when running real providers:

```bash
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

The renderer never receives raw credential values. It only receives provider readiness metadata and credential source/status.

There is no runtime dependency on `DATABASE_URL`, Prisma, or Postgres.

## Recovery Strategy
- SQLite runs with `WAL`, foreign keys, and a busy timeout.
- Project deletion removes SQLite rows and app-data asset/preview directories.
- Topaz download-envelope assets are repaired on read if a legacy JSON envelope is encountered instead of image bytes.
- Canvas saves are hydration-gated so an empty default document cannot overwrite a real stored graph during initial load.
