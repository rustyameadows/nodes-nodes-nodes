# Electron Migration Plan

## Goal
Ship a local Electron desktop app that replaces the current Next.js + Postgres runtime with:

- Electron main + preload + worker
- Vite + React renderer
- SQLite + Drizzle + `better-sqlite3`
- TanStack Router + TanStack Query

The first accepted finish is local source-run on macOS with:

```bash
npm run dev
```

No Postgres, Prisma, Next server, or `pg-boss` remain in the runtime path.

## Target Architecture

### Processes
- `main`
  - Electron lifecycle
  - BrowserWindow
  - native menus and file dialogs
  - app-data path setup
  - `app-asset://` protocol
  - IPC registration
  - worker supervision
- `preload`
  - typed `window.nodeInterface` bridge
- `renderer`
  - React UI
  - TanStack Router
  - TanStack Query
  - no direct DB/filesystem/secret access
- `worker`
  - durable job polling and claims
  - provider execution
  - preview persistence
  - final asset writes

### Storage
- SQLite database under Electron `userData`
- local asset and preview-frame folders beside the database
- WAL mode
- foreign keys enabled
- busy timeout set

## Ordered Migration Phases
1. Replace package/runtime scaffolding with Electron, Vite, Drizzle, and TanStack.
2. Stand up Electron main, preload, renderer bootstrap, and worker bootstrap.
3. Add SQLite schema and local storage layout.
4. Port current route-handler logic into shared services.
5. Replace `pg-boss` with SQLite-backed job polling.
6. Replace Next routing and data loading with TanStack Router and Query.
7. Replace HTTP asset/file flows with `app-asset://`.
8. Reconnect the existing workspace views.
9. Remove obsolete Next/Postgres/Prisma runtime files.
10. Update docs and verify the desktop path.

## Package Swaps

### Add
- `electron`
- `vite`
- `tsup`
- `electronmon`
- `wait-on`
- `drizzle-orm`
- `drizzle-kit`
- `better-sqlite3`
- `@tanstack/react-router`
- `@tanstack/react-query`
- `@electron/rebuild`

### Remove from runtime
- `next`
- `@prisma/client`
- `prisma`
- `pg`
- `pg-boss`

## SQLite Schema / Storage Layout

### Keep
- `projects`
- `project_workspace_states`
- `canvases`
- `jobs`
- `job_attempts`
- `assets`
- `job_preview_frames`
- `asset_feedback`
- `asset_tags`
- `asset_tag_links`
- `provider_models`

### Remove
- `canvas_nodes`
- `canvas_edges`

### Queue fields
Add to `jobs`:
- `availableAt`
- `claimedAt`
- `claimToken`
- `lastHeartbeatAt`

### Filesystem layout
- `<appData>/node-interface-demo/app.sqlite`
- `<appData>/node-interface-demo/assets/<projectId>/...`
- `<appData>/node-interface-demo/previews/<jobId>/...`

## Preload API
- `listProjects`
- `createProject`
- `updateProject`
- `deleteProject`
- `openProject`
- `getWorkspaceSnapshot`
- `saveWorkspaceSnapshot`
- `listAssets`
- `getAsset`
- `updateAsset`
- `importAssets`
- `listJobs`
- `createJob`
- `getJobDebug`
- `listProviders`
- `subscribe(eventName, listener)`

## Queue Behavior
- worker polls queued jobs by `availableAt`
- one atomic claim per job
- claimed jobs heartbeat while running
- success persists outputs and marks `succeeded`
- failure retries with bounded backoff or marks `failed`
- stale claimed jobs are returned to `queued` at startup

## Local Run / Build Commands
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run db:generate`

## Acceptance Checklist
- `npm run dev` launches Electron locally
- no Next server is required
- no Postgres is required
- first launch creates the SQLite DB and asset directories
- project lifecycle works
- canvas save/load works
- assets import and render through `app-asset://`
- jobs execute through the worker and survive restarts
- provider readiness still reflects env configuration
- the current color system transfers into the desktop app
