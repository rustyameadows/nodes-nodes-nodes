# UX Spec: Canvas and Asset Viewer

## Workspace Views
- `/`
  - app home with create-project actions, active project grid, and archived project section
- `/settings/app`
  - app-wide provider credentials and readiness
- `/projects/$projectId/canvas`
- `/projects/$projectId/assets`
- `/projects/$projectId/assets/$assetId`
- `/projects/$projectId/queue`
- `/projects/$projectId/settings`
  - project-only metadata and lifecycle actions

## Visual Direction
- Preserve the existing dark palette and glass/text tokens.
- Preserve semantic canvas colors:
  - pink for text
  - blue for image assets
  - orange for video
  - citrus for generated output flow
- Functional parity matters more than exact shell/layout parity.

## Canvas
- full-viewport custom infinite canvas
- pan, zoom, drag, connect, multi-select, marquee select
- dragging one selected node moves that node; dragging any node inside a multi-selection moves the full selected group and commits as one canvas change
- insert actions for:
  - model node
  - text note
  - list node
  - text template
  - native asset import
  - generated asset pointer
  - uploaded asset pointer
- macOS native `Canvas` menu mirrors the primary node insert actions:
  - add node popup
  - add model node
  - add text note
  - add list node
  - add text template
  - connect selected nodes
  - duplicate selected node
  - undo canvas change
  - redo canvas change
- native canvas insertions land at the current viewport center with a small stagger and use the same save/selection path as the insert popup
- bottom settings bar remains the main node-configuration surface
- primary editor entry points:
  - `Enter` opens the selected node's primary bottom-bar tray
  - node double-click opens the same primary tray for the clicked node
- primary editor mapping:
  - model -> `Prompt`
  - text note -> `Note`
  - list -> `List`
  - text template -> `Template`
  - uploaded asset source -> `Details`
  - generated asset / generated text -> `Source`
- canvas keyboard shortcuts when focus is not inside an input, textarea, select, or contenteditable surface:
  - `A` opens the add-to-canvas insert menu at viewport center
  - `C` connects exactly two selected nodes from oldest selected -> newest selected
  - `Enter` opens the primary editor tray for a single selected node
  - `Cmd/Ctrl+D` duplicates the single selected node
  - `Delete` / `Backspace` removes the selected node(s) or selected connection
  - `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` undo/redo scoped canvas changes
  - `Escape` closes insert menus, popovers, and connection selection
- undo/redo scope:
  - included: add, delete, duplicate, connect/disconnect, batch move, clear inputs, bottom-bar text/settings edits, list edits, template text edits, generate-template-rows
  - excluded: viewport pan/zoom, queue state changes, polling-driven generated output hydration, and async placeholder reconciliation

## Queue Feedback
- running jobs show queue state in the queue view and on generated output nodes
- OpenAI image jobs can show persisted preview frames before final completion
- successful image jobs hydrate output nodes with final assets
- successful GPT text jobs hydrate generated text-note nodes

## Asset Viewer
- Grid view
- 2-up compare
- 4-up compare
- Single asset detail view

Controls:
- rating
- flagged state
- tags
- sorting
- filtering by type, provider, tag, flagged state, and rating

## Desktop-Specific UX Changes
- app startup lands on the app home view instead of auto-resuming directly into a project route
- app home is reachable from the in-canvas `Menu` pill, app settings, and the native macOS `Project` menu
- browser uploads are replaced by native file dialogs
- asset and preview rendering uses `app-asset://` URLs
- renderer never sees raw local file paths
- queue/state updates arrive through preload events and TanStack Query invalidation
