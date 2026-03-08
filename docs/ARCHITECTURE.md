# Architecture (V1 Local-First Desktop)

## Stack
- Shell: Electron main + preload + worker.
- Renderer: Vite + React + TanStack Router + TanStack Query.
- Inline list sheet engine: TanStack Table (headless, canvas-only).
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
- App data root: explicit path under Electron `appData`, pinned to `~/Library/Application Support/Nodes Node Nodes/node-interface-demo` on macOS
- SQLite file: `app.sqlite`
- Asset binaries: `assets/<projectId>/...`
- Preview frames: `previews/<jobId>/...`

The runtime also works outside Electron for tests and CLI builds by falling back to a repo-local `.local-desktop` folder.

On macOS desktop runs, local project data is resolved from a stable compatibility path instead of following the display name. This prevents branding changes from moving the live SQLite/assets directory.

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
- renderer reports `{ projectId, view, hasProjects, selectedNodeCount, canConnectSelected, canDuplicateSelected, canUndo, canRedo }` through `setMenuContext`
- main rebuilds the macOS app menu with project-aware enabled states and dynamic project submenus
- main emits native menu commands back to renderer through `subscribeMenuCommand`
- canvas-specific native menu commands are forwarded inside the renderer to `CanvasView`, which reuses the same insert helpers as the in-canvas insert popup and the same canvas command path as keyboard shortcuts
- `Home` is a dedicated app-level route at `/`
- `App Settings` is a dedicated global route at `/settings/app`, separate from project-scoped settings

TanStack Query owns persisted app data in the renderer and is invalidated from those desktop events.

## Canvas Interaction Model
- `CanvasView` owns a local canvas command layer for native menu commands and canvas-scoped keyboard shortcuts.
- Canvas keyboard shortcuts are registered through TanStack Hotkeys with input ignoring enabled, so canvas commands do not fire while editable controls are focused.
- `CanvasView` derives node presentation from persisted node-local metadata (`displayMode`, `size`) plus transient active-node state (`activeFullNodeId`).
- `CanvasNodeContent` renders mode-aware inline node surfaces for model, text note, list, template, and asset nodes.
- `InfiniteCanvas` renders live drag previews, resize handles, phantom previews, quick mode transitions, and the edge-mounted run launcher, but committed node movement is written back once per drag through `onCommitNodePositions`.
- Multi-node drag uses the current selection as a batch and preserves relative spacing across the moved nodes.
- Full/resized nodes switch drag to a header/chrome handle so clicking into inline controls does not collapse the editor or start dragging.
- Asset/image nodes are the exception to chrome-only drag so resized media cards can still be repositioned directly from the preview surface.
- Primary inline editor routing is resolved by node type:
  - model -> `prompt`
  - text note -> `note`
  - list -> `list`
  - text template -> `template`
  - uploaded asset source -> `asset-details`
  - generated asset / generated model-spawned nodes -> `source-call`
- Phantom output previews are renderer-only derived state. They appear only for the active node, never persist to the canvas document, and never participate in selection/history.
- Template/list compatibility and merge preview are computed in `CanvasView` from the existing template preview engine and rendered inline inside the template node.
- Full/resized list nodes render through a dedicated inline sheet component backed by TanStack Table, while preview and compact states stay on lightweight custom card renderers.
- Full template mode suppresses external phantom row cards and relies on the inline side-rail merge preview instead.

## Canvas History Model
- Undo/redo is renderer-local and scoped to the active canvas document.
- Each history entry stores:
  - `canvasDoc`
  - `selectedNodeIds`
  - `selectedConnection`
- Structural graph changes push immediate history entries.
- Typing-like inline node edits are coalesced by field and committed on blur, full-mode exit, selection change, or a short idle timeout.
- Undo/redo intentionally excludes:
  - viewport pan/zoom
  - worker-driven queue updates
  - polling-driven generated output hydration
  - async placeholder reconciliation for generated nodes

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
7. Worker persists final outputs as assets or text-response metadata with parsed generated-node descriptors.
8. Worker records attempt metadata, marks terminal job state, and emits `jobs.changed` plus `assets.changed` when needed.

## Structured Text Output Flow
- Runnable OpenAI text models expose `textOutputTarget` in model settings.
- `note` uses the user-selected text output format (`text`, `json_object`, or `json_schema`) and hydrates one generated text note.
- `list`, `template`, and `smart` override the OpenAI text format with app-owned strict JSON schema plus system instructions.
- Worker-side parsing validates those structured responses into generated-node descriptors before they reach the renderer.
- `CanvasView` hydrates model-spawned notes, lists, and templates from `job.generatedNodeDescriptors` instead of parsing raw provider text in the renderer.
- `smart` spawns multiple unconnected nodes in this pass; explicit `list` and `template` targets still use deterministic placeholders while queued/running.

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
7. Renderer window is created and routed to app home.
8. App home lists projects and opens a selected project onto its canvas.

## Configuration
Provider credentials resolve in this order:
1. macOS Keychain values saved from App Settings
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
