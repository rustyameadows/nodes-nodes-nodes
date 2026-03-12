# Architecture (V1 Local-First Desktop)

## Stack
- Shell: Electron main + preload + worker.
- Renderer: Vite + React + TanStack Router + TanStack Query.
- Inline list sheet engine: custom canvas spreadsheet surface.
- Persistence: SQLite via Drizzle and `better-sqlite3`.
- Queue: durable SQLite-backed job polling in a dedicated worker process.
- Asset storage: local filesystem under the Electron app-data root.
- Canvas: custom React infinite canvas engine.

## Design System and Surface Modes
- The renderer uses a lightweight in-repo design system built from:
  - `src/styles/design-system/` token/contracts files
  - CSS custom properties imported globally
  - shared primitives in `src/components/ui/`
- The design system has two surface contexts:
  - `app` for non-canvas routes and desktop shell views
  - `canvas-overlay` for floating chrome above the canvas
- The design system also has a sibling canvas-node layer under `src/styles/design-system/nodes/` and `src/components/canvas-nodes/`.
- The canvas-node layer reuses shared foundations but owns its own recipes so node cards do not inherit the light app-shell treatment.
- Protected areas:
  - graph connection visuals in `InfiniteCanvas`
  - the black canvas background treatment
- Allowed design-system ownership around protected areas:
  - workspace menu shell
  - insert picker and asset picker
  - bottom-bar popovers
  - bottom-center canvas selection rail
  - Node Library detail framing around the playground canvas

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
  - canvas upload flows and menu bar imports reuse the same uploaded-asset node insertion helper so uploaded source nodes get consistent labels, metadata, and aspect ratios
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
- `refreshProviderAccess`
- `saveCanvasPngExport`
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

## Canonical Node Catalog
- `src/lib/node-catalog.ts` is the canonical registry for built-in node metadata.
- The catalog describes user-visible node entries, not just raw `WorkflowNode.kind` values.
- It drives:
  - the app-level Node Library routes
  - the canvas insert picker
  - native macOS `Canvas > Add…` menus
  - the shared searchable provider+model control
  - the machine-readable node summaries used by structured text-output prompt builders
- The catalog is pure metadata and fixture generation. Real node creation and mutation still happen through the existing canvas/workspace mutation paths.
- Model variants are derived from the provider catalog with stable IDs like `model:openai:gpt-image-1.5`.

## Node Library
- App-level routes:
  - `/nodes`
  - `/nodes/$nodeId`
- `/nodes` is a searchable gallery of built-in node entries from the catalog.
- `/nodes/$nodeId` is a design/debug detail page with:
  - left-rail node metadata and settings summary
  - a reusable searchable provider+model selector for model nodes
  - an ephemeral interactive playground framed by the app design system while the inner playground canvas keeps the same node renderer path as the real project canvas
- The playground intentionally reuses the real canvas node renderers and editing surfaces instead of a separate mock UI.

## Canvas Interaction Model
- `CanvasView` owns a local canvas command layer for native menu commands and canvas-scoped keyboard shortcuts.
- Canvas keyboard shortcuts are registered through TanStack Hotkeys with input ignoring enabled, so canvas commands do not fire while editable controls are focused.
- Canvas insertion surfaces are registry-driven:
  - the insert picker builds visible node rows from the node catalog
  - `Add Model Node` expands into provider-grouped model variants from the provider catalog
  - native macOS `Canvas` add menus use the same catalog/provider source
- Canvas overlays use the `canvas-overlay` surface, while node cards use the dedicated canvas-node system.
- `CanvasView` also mounts a renderer-local `CanvasCopilotWidget` in the overlay layer. It is not persisted in the canvas document and is not represented by a hidden model node.
- `CanvasView` and `NodePlaygroundCanvas` derive node presentation from persisted node-local metadata (`displayMode`, `size`) plus transient active-node state through `resolveCanvasNodePresentation`; model nodes may now persist `full` directly on the node, while template edit/full remains transient renderer state.
- `CanvasView` also listens for external same-project workspace mutations flagged as asset imports so menu bar uploads can refresh the live canvas without forcing a route remount.
- Selected-node cleanup and selection PNG export both reuse a renderer-local plain-data graph layout module that computes deterministic left-to-right positions, disconnected component stacking, and export bounds without depending on DOM layout ownership.
- `CanvasNodeContent` in `src/components/canvas-nodes/` renders shared rails plus mode-aware node bodies for model, text note, list, template, and asset nodes.
- `InfiniteCanvas` renders live drag previews, resize handles, phantom previews, quick mode transitions, and the edge-mounted run launcher, but committed node movement is written back once per drag through `onCommitNodePositions`.
- Multi-node drag uses the current selection as a batch and preserves relative spacing across the moved nodes.
- `Clean Up Selection` mutates only the selected nodes and records one immediate canvas history entry.
- `Capture PNG` builds an induced selected subgraph, lays it out in an ephemeral export scene, rasterizes the SVG in the renderer, and hands the encoded PNG bytes to the Electron main process for native save-dialog persistence.
- Active node cards switch drag to floating rail/hotspot affordances so inline controls stay editable without causing content shift.
- Double-click node focus is owned by `CanvasView`: it may first change the node's presentation state, then waits for the node shell to settle before animating the viewport fit.
- Primary inline editor routing is resolved by node type:
  - model -> `prompt`
  - text note -> `note`
  - list -> `list`
  - text template -> `template`
  - uploaded asset source -> `asset-details`
  - generated asset / generated model-spawned nodes -> `source-call`
- Phantom output previews are renderer-only derived state. They appear only for the active node, never persist to the canvas document, and never participate in selection/history.
- Template/list compatibility is still computed in `CanvasView` from the existing template preview engine, but the template node keeps merge emphasis light and leaves row-output emphasis to phantom/generated previews.
- List nodes render through a shared inline spreadsheet surface with column resizing and a draft-entry row; preview, active, and resized states all reuse the same visual language.

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
  - pending generated-output preview updates
  - one-time generated-output insertion/receipt migration

## Asset Delivery
- Assets and preview frames are served through the read-only `app-asset://` protocol.
- Examples:
  - `app-asset://asset/<assetId>`
  - `app-asset://preview/<previewFrameId>?ts=<createdAt>`
- The renderer never receives raw filesystem paths.
- Native asset imports can return lightweight `ImportedAssetResult` envelopes so renderer insertion preserves user-facing source names from the file dialog while still persisting normal `Asset` records.

## Job Flow
1. Canvas resolves a concrete run request from the active graph.
2. Renderer submits `createJob(...)` through preload.
3. Main writes the `jobs` row to SQLite and emits `jobs.changed`.
4. Worker polls eligible `queued` jobs and atomically claims one.
5. Worker marks heartbeats while the provider call is running.
6. Provider adapter emits preview frames when supported.
7. Worker persists final outputs as assets and/or text-response metadata with parsed generated-node descriptors.
8. Worker records attempt metadata, marks terminal job state, and emits `jobs.changed` plus `assets.changed` when needed.

Copilot run path:
- `CanvasCopilotWidget` resolves a text-capable provider model from the same searchable model selector used elsewhere.
- The widget submits a normal `createJob(...)` request with `nodeRunPayload.runOrigin = "copilot"` instead of synthesizing a hidden canvas model node.
- The worker parses the response through the same structured text-output pipeline used by text model nodes.
- `CanvasView` hydrates generated nodes once, inserts them near the current viewport center, applies any valid generated connections, and appends transcript status rows.

## Structured Text Output Flow
- Runnable OpenAI and Gemini text models expose `textOutputTarget` in model settings.
- `note` hydrates one generated text note.
- `list`, `template`, and `smart` override provider-native output formatting with app-owned strict structured output plus system instructions.
- OpenAI still supports its extra provider-specific controls (`verbosity`, `reasoningEffort`, optional note output formats).
- Gemini resolves settings through model-family profiles:
  - shared text controls: `textOutputTarget`, `maxOutputTokens`, `temperature`, `topP`, `topK`
  - Gemini 3 flash-family models add `thinkingLevel`
  - Gemini 2.5-family models add `thinkingBudget`
- Worker-side parsing validates those structured responses into generated-node descriptors before they reach the renderer.
- Mixed Gemini image jobs may also emit structured text in the same provider response; the worker reads the text output target from output metadata before falling back to node settings.
- Generated descriptors now include stable response-local `descriptorId` values plus a `runOrigin` of `canvas-node` or `copilot`.
- `smart` may also return generated connection descriptors keyed by those descriptor IDs.
- `CanvasView` inserts model-spawned notes, lists, and templates once from `job.generatedNodeDescriptors` instead of parsing raw provider text in the renderer.
- `CanvasView` now hydrates generated image assets and generated text descriptors independently for the same job, so mixed-output image models can materialize every returned image asset plus any returned text descriptors from one run.
- `CanvasView` applies valid generated connections after node insertion and drops invalid, duplicate, or out-of-scope links with a warning.
- Root generated descriptors keep a visible source-model anchor unless a valid generated connection already targets that descriptor, so mixed outputs stay discoverable without overriding provider-specified wiring.
- Model-spawned placeholders and final children now use the same visible-edge spawn anchor as the phantom preview, so active expanded model nodes materialize outputs where the preview projected them.
- Pending generated-output placeholders/previews may exist while a job is unresolved, but once the final child nodes are inserted the polling loop no longer mutates them.
- The canvas document stores `generatedOutputReceiptKeys` so completed outputs are materialized once, deleted generated nodes do not return, reruns append fresh children instead of replacing older ones, and stale generated-image placeholders can self-heal if a receipt exists but the node still lacks its asset pointer.
- `smart` can now spawn multiple nodes plus optional valid wiring in one pass; explicit `list` and `template` targets may still show deterministic placeholders while queued/running.
- Gemini image settings are also model-aware:
  - shared Gemini image controls: `temperature`, `aspectRatio`, `maxOutputTokens`, `topP`, `stopSequences`
  - `gemini-3-pro-image-preview` also exposes `imageSize`
  - `gemini-3.1-flash-image-preview` also exposes `outputMode`, `imageSize`, and `thinkingLevel`
  - `gemini-3.1-flash-image-preview` `Images & Text` reuses the `smart` structured-output contract for its text modality, but as of March 10, 2026 the provider behavior is still experimental and may return image-only
- successful mixed image-only Gemini attempts persist typed diagnostics in `job_attempts.provider_response` so queue inspection can explain that Gemini omitted text instead of implying a renderer parse failure
- queue inspection is split into a dense `/queue` run ledger plus a dedicated `/queue/$jobId` execution-record route
- OpenAI-style image settings are pruned from Gemini image nodes instead of being carried through as inert payload noise
- The smart-output prompt builder derives allowed node kinds and payload summaries from the node catalog instead of hardcoded node descriptions.

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
3. Provider-model metadata is synchronized into `provider_models`, including Gemini access refresh.
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

Gemini access detection is hybrid:
- the static model catalog ships billing hints copied from Google pricing docs
- the saved Google project key is probed with Gemini `models.list()`
- runtime provider errors can still downgrade a model to blocked or limited after a failed job

There is no runtime dependency on `DATABASE_URL`, Prisma, or Postgres.

## Recovery Strategy
- SQLite runs with `WAL`, foreign keys, and a busy timeout.
- Project deletion removes SQLite rows and app-data asset/preview directories.
- Topaz download-envelope assets are repaired on read if a legacy JSON envelope is encountered instead of image bytes.
- Canvas saves are hydration-gated so an empty default document cannot overwrite a real stored graph during initial load.
