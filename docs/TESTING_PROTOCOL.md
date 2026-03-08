# Testing Protocol

## Goal
Verify the desktop app in layers so failures are isolated quickly:
1. static correctness
2. build correctness
3. Electron app boot
4. automated unpackaged desktop smoke flow
5. automated packaged mac smoke flow
6. optional manual provider checks

## Baseline Commands
Run these from the repo root:

```bash
npm run lint
npm run test:unit
npm run build
npm run db:generate
```

Expected results:
- `lint` passes
- `test:unit` passes
- `build` emits `dist/renderer` and `dist/electron`
- `db:generate` emits a migration under `drizzle/`

## Primary Desktop Smoke Test
Use the automated Electron smoke flow:

```bash
npm run smoke:electron
```

What it does:
- builds the app
- launches the real Electron app from `dist/electron/main.cjs`
- uses a temporary `NODE_INTERFACE_APP_DATA` directory
- inspects the native application menu from Electron main
- waits for app home
- opens app settings from app home before any project exists
- creates a project from the native `File > New Project` menu
- triggers one native `Canvas > Add Model Node` command on canvas
- writes a canvas snapshot with two nodes through the live preload bridge
- verifies canvas interaction behavior in the real Electron window:
  - `A` opens the insert menu
  - multi-selected nodes move as one batch
  - `C` connects exactly two selected nodes
  - `Enter` opens the selected node's inline full editor
  - node double-click opens the same primary inline editor mapping
  - `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` undo/redo batch move, connection, inline edit, and node insertion
  - typing inside inline editors does not trigger canvas shortcuts
  - resized asset nodes can still be dragged after resize
  - list full mode renders as a real editable sheet
  - template full mode keeps chips, editor, and merge preview contained
- imports an SVG asset through the live preload bridge
- navigates through assets, queue, project settings, and app settings through native menu commands
- verifies:
  - preload bridge exists
  - native `File`, `Project`, `Canvas`, `View`, and `Window` menus exist
  - app home app settings works without a project
  - reloading `/` with existing projects stays on app home
  - app home shows archived projects in a separate section when archived projects exist
  - app home can reopen an existing project card
  - `Home` works from the workspace Menu pill and native mac menu
  - SQLite file is created
  - native new-project and add-node commands round-trip into the renderer
  - canvas data round-trips
  - canvas shortcuts stay canvas-scoped and do not fire while a prompt editor or other editable control is focused
  - asset metadata exists
  - asset file exists on disk
  - queue screen renders
  - project settings render with project metadata only
  - provider credentials render in app settings
- writes screenshots into the temp app-data directory, including dedicated adaptive-node visual artifacts

Expected output:
- JSON summary printed to stdout with:
  - `projectId`
  - `appDataRoot`
  - `canvasScreenshotPath`
  - `modelPreviewScreenshotPath`
  - `modelFullScreenshotPath`
  - `listFullScreenshotPath`
  - `templateFullScreenshotPath`
  - `resizedAssetScreenshotPath`
  - `assetsScreenshotPath`
  - `queueScreenshotPath`
  - `projectSettingsScreenshotPath`
  - `appSettingsScreenshotPath`
  - `providerSummary`
  - `nodeLabels`
  - `assetCount`
  - `storedAssetFiles`

Important:
- `npm run smoke:electron` launches the unpackaged Electron runtime from `dist/electron/main.cjs`
- it is expected to look like a generic Electron app in macOS process chrome
- it always uses a temporary `NODE_INTERFACE_APP_DATA` directory

## Packaged Mac Smoke Test
Use the packaged mac smoke flow:

```bash
npm run smoke:packaged:mac
```

What it does:
- builds the app
- packages the unsigned Apple Silicon `.app` and `.zip`
- validates the packaged bundle metadata and unpacked native modules
- launches the packaged `.app` executable through Selenium + `electron-chromedriver`
- uses a temporary `NODE_INTERFACE_APP_DATA` directory so it does not touch your manual packaged-app data
- verifies:
  - branded bundle metadata and icon wiring
  - preload bridge availability
  - app home render
  - app settings render with provider credentials before any project exists
  - project creation
  - canvas round-trip
  - model full screenshot capture
  - list full screenshot capture
  - template full screenshot capture
  - asset import and assets view render
  - queue view render
  - project settings render without provider credentials
  - app settings render with provider credentials
  - packaged SQLite and on-disk asset persistence

Expected output:
- JSON summary printed to stdout with:
  - `appPath`
  - `executablePath`
  - `zipPath`
  - `appDataRoot`
  - `projectId`
  - screenshot paths
  - `providerSummary`

Important:
- `npm run smoke:packaged:mac` targets the packaged `.app`, not the unpackaged dev runtime
- it may briefly open a second packaged-app window while it runs
- it does not reuse your manual packaged-app data root

## Full Lifecycle Verification
Use the end-to-end mac lifecycle command:

```bash
npm run verify:mac-lifecycle
```

It runs:
1. `npm run smoke:packaged:mac`
2. `node --import tsx scripts/print-mac-artifacts.ts`

The final artifact summary prints the `.app`, executable, and `.zip` paths.

## Dev-App Verification
For interactive testing:

```bash
npm run dev
```

This should:
- start Vite on `http://localhost:5173`
- watch-build Electron main/preload/worker bundles
- launch Electron against the dev server

Important:
- `npm run dev` is the unpackaged source-run app
- it is separate from the packaged `.app`
- if both are open at once, they are different processes and may use different data roots

If `npm run dev` fails with `Port 5173 is already in use`, clear the stale dev server first:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <pid>
```

## Browser-Only Renderer Smoke
When debugging renderer UI separate from preload/main:

1. run `npm run dev`
2. open `http://localhost:5173`

The renderer has a browser fallback bridge for smoke inspection only. Use this for:
- app home rendering
- route rendering
- CSS/token verification
- quick TanStack Router/Query checks

Do not treat browser fallback mode as a substitute for Electron smoke.

## Manual Desktop Checklist
Run this when touching workflow or asset UX:

1. Launch `npm run dev`.
2. Confirm app home renders.
3. Open App Settings from home and return to home.
4. Create a project from app home.
5. Confirm the canvas route loads.
6. Open Home from the in-app `Menu` pill and confirm the project card is visible.
7. Reopen the project from home.
8. Add or restore at least one text note and one model node.
9. Multi-select two nodes and drag them together.
10. Press `C` with exactly two selected nodes and confirm a connection is created.
11. Press `Enter` on a single selected node and confirm the expected inline full editor opens.
12. Double-click a node and confirm it opens the same primary inline editor as `Enter`.
13. Click into a prompt, note, list cell, or template textarea and confirm canvas shortcuts do not fire while typing.
14. Resize a text/list/template/asset node and confirm the size persists after deselecting or reloading.
15. Open a template node with a connected list and confirm variable chips, compatibility state, and merge preview render inline.
16. Open a list node in full mode and confirm it behaves like an inline editable sheet instead of the old stacked field controls.
17. Resize an asset node, then drag it directly from the media surface and confirm it still moves cleanly.
18. Confirm phantom output previews appear only for the active node and disappear when you deselect or change selection.
19. Use `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` to undo/redo one move, one connection, and one inline edit.
20. Import an asset.
21. Open the Assets view and confirm the imported asset appears.
22. Open Project Settings and confirm the project metadata renders and provider credentials do not appear there.
23. Open App Settings and confirm provider credentials render there.
24. If testing on macOS, confirm:
   - `File`, `Project`, `Canvas`, `Edit`, `View`, and `Window` menus appear
   - `Cmd+,` opens App Settings
   - `File > New Project` opens a new project
   - `Project > Home` returns to app home
   - `Project > Assets` / `Queue` / `Project Settings` match the in-app menu behavior
   - `Canvas > Add Node…`, `Connect Selected Nodes`, `Duplicate Selected Node`, `Undo Canvas Change`, and `Redo Canvas Change` enable or disable correctly on canvas
25. If API keys are configured, run at least one real provider job and verify:
   - queue row created
   - state changes visible
   - output lands on canvas or in assets as appropriate

## Manual Packaged-App Checklist
Run this against the packaged `.app` after `npm run package:mac`:

1. Open `release/mac-arm64/Nodes Nodes Nodes.app` from Finder.
2. Confirm the app name and pink icon appear in macOS chrome.
3. Open App Settings.
4. Save an OpenAI or Topaz key to Keychain.
5. Confirm provider readiness updates without editing `.env.local`.
6. Create or open a project.
7. Run a real node.
8. Confirm queue progress and final output persistence.
9. Quit and relaunch the packaged app.
10. Confirm the project reopens and Keychain-backed readiness persists.
11. Confirm the native `Project` and `Canvas` menus behave the same as the unpackaged app.

## Troubleshooting

### Blank Electron window
Check:
- Electron dev process is using `NODE_ENV=development`
- `ELECTRON_RENDERER_URL` points at `http://localhost:5173`
- no stale `dist/electron` cleanup is racing Electron restarts

### Preload missing in dev
Symptoms:
- black window
- `Unable to load preload script`
- `window.nodeInterface` missing

Check:
- `tsup` watch build is not cleaning `dist/electron` on every rebuild
- `dist/electron/preload.cjs` exists before Electron restart

### App works in browser but not Electron
That usually means a preload/main problem, not a React problem. Re-run:

```bash
npm run smoke:electron
```

and inspect the printed temp `appDataRoot` plus screenshots.

When adaptive-node work changes, inspect these screenshot artifacts first:
- `canvas-model-preview.png`
- `canvas-model-full.png`
- `canvas-list-full.png`
- `canvas-template-full.png`
- `canvas-resized-asset.png`

## When To Update This Doc
Update this protocol when any of these change:
- app run commands
- build commands
- smoke-test command or coverage
- Electron boot path
- mac packaging or packaged-app verification flow
- required verification steps for canvas/assets/queue flows
