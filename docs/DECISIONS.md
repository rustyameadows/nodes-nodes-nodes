# Decisions Log

## 2026-03-04 - Local-First Single-User Product
- Decision: optimize for one local user with multiple isolated projects.
- Rationale: the product loop is project -> canvas -> generation -> review, not collaboration.
- Consequence: accounts, sharing, and permissions remain out of scope in v1.

## 2026-03-05 - One Canvas per Project
- Decision: keep exactly one canvas per project in v1.
- Rationale: it keeps project switching and persistence deterministic while the node workflow is still evolving.
- Consequence: future multi-canvas support will require schema and UX expansion.

## 2026-03-05 - Canvas Stores the Graph as JSON
- Decision: persist the graph in `canvases.canvas_document` instead of relational node/edge tables.
- Rationale: the current UI already operates on a document model, and extra node/edge tables were unused complexity.
- Consequence: `canvas_nodes` and `canvas_edges` are not part of the desktop data model.

## 2026-03-06 - GPT Text Outputs Stay Note-Native
- Decision: OpenAI GPT text runs produce generated canvas notes, not assets.
- Rationale: those outputs are meant to feed later graph steps, not clutter the visual asset library.
- Consequence: text responses stay in queue attempt metadata and canvas state rather than asset storage.

## 2026-03-07 - Direct Electron Cutover
- Decision: replace the Next.js web runtime with a direct Electron desktop app instead of wrapping the old web app.
- Rationale: local file access, native dialogs, a dedicated worker, and a clean desktop boundary are all easier with a real Electron architecture.
- Consequence: the runtime is now split into Electron main, preload, renderer, and worker processes.

## 2026-03-07 - SQLite and Drizzle Replace Postgres and Prisma
- Decision: move local persistence to SQLite via Drizzle and `better-sqlite3`.
- Rationale: the app is single-user and local-first, so an embedded database removes unnecessary setup and better fits the desktop runtime.
- Consequence: there is no Postgres or Prisma dependency in the active runtime, and old data is not migrated.

## 2026-03-07 - Durable Queue Moves into SQLite
- Decision: replace `pg-boss` and inline execution modes with a worker-owned SQLite queue.
- Rationale: the desktop app still needs durable retries and restart recovery, but it no longer needs a separate queue backend.
- Consequence: queue state lives on the `jobs` table with claim, heartbeat, and availability fields.

## 2026-03-07 - TanStack Is the Renderer Foundation
- Decision: use TanStack Router for routing and TanStack Query for persisted app data.
- Rationale: the Electron renderer still needs a modern client-side application foundation after leaving Next.js.
- Consequence: renderer navigation is code-routed and desktop events invalidate query-backed data caches.

## 2026-03-07 - Mac Packaging Uses Electron Builder
- Decision: package the local mac app with `electron-builder`, targeting unsigned Apple Silicon `.app` and `.zip` artifacts first.
- Rationale: it produces a repeatable local packaging pipeline with app metadata, icons, native-module handling, and stable artifact paths.
- Consequence: packaged builds are generated under `release/`, and packaging verification is part of the desktop lifecycle.

## 2026-03-07 - Provider Credentials Are Keychain-First
- Decision: provider credentials resolve from macOS Keychain first, then fall back to environment variables.
- Rationale: packaged apps need to be configurable from Finder without editing repo-local env files, while source-run development should keep working.
- Consequence: App Settings now exposes credential status plus save/clear actions, and provider readiness reflects Keychain-backed state.

## 2026-03-07 - Packaged Mac Smoke Uses Selenium and ChromeDriver
- Decision: automate the packaged `.app` verification path with Selenium plus `electron-chromedriver`.
- Rationale: the packaged app is more stable to drive through WebDriver than Playwright's Electron attachment path in this environment.
- Consequence: `npm run smoke:packaged:mac` launches the bundled `.app` through ChromeDriver and verifies the packaged lifecycle against a temporary app-data root.

## 2026-03-08 - Canvas Undo/Redo Stays Local and Scoped
- Decision: keep undo/redo as renderer-local canvas history instead of a persisted app-wide history system.
- Rationale: the first pass needs reliable canvas editing recovery without coupling async worker hydration, queue changes, or viewport movement into a global command log.
- Consequence: undo/redo covers user-initiated canvas graph edits and bottom-bar node edits only, and resets when the canvas view is reloaded or the session changes.

## 2026-03-08 - Desktop Data Path Is Pinned Independently From Branding
- Decision: pin Electron `userData` to a stable on-disk directory instead of letting it follow the display name.
- Rationale: Electron defaults `userData` from the app name, and a branding-only rename should never make the app look blank or silently switch SQLite/assets folders.
- Consequence: the packaged app name can change without moving live local data, and the macOS data root intentionally stays at the compatibility path `~/Library/Application Support/Nodes Node Nodes/node-interface-demo`.

## 2026-03-08 - Startup Lands On App Home
- Decision: route desktop startup to a persistent app-level home view instead of auto-opening the last project route.
- Rationale: a visible project picker is a better top-level desktop pattern now that the app supports multiple local projects plus app-level settings.
- Consequence: `/` always renders app home, project picking moves onto a dedicated grid/list screen, and the open-project marker remains metadata rather than startup routing state.
