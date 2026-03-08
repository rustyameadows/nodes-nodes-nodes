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
- node presentation states:
  - `preview` is the default persisted state
  - `compact` is a persisted pill/tiny-node state
  - `full` is transient and applies only to the active single-selected node
  - `resized` is a persisted custom size for text notes, lists, templates, and asset nodes
- mode changes animate quickly on shell size/content transitions, but those transitions shut off while dragging, resizing, or panning
- inline full-mode entry points:
  - `Enter` opens the selected node's inline full editor
  - node double-click opens the same inline full editor for the clicked node
- primary editor mapping:
  - model -> `Prompt`
  - text note -> `Note`
  - list -> `List`
  - text template -> `Template`
  - uploaded asset source -> `Details`
  - generated asset / generated model-spawned nodes -> `Source`
- full/resized nodes use a header/chrome drag handle so text areas, table cells, and inline controls stay editable without dragging the node
- asset/image nodes are the exception to chrome-only drag: dragging directly on the media surface still moves the node, while quick-action controls stop propagation
- model preview stays close to the original small model card
- model full mode follows the issue `#44` direction: one wide horizontal shell with inputs on the left, prompt/editor in the middle, model settings next, and output/run controls aligned toward the output edge
- list full/resized mode is an inline sheet:
  - editable header row
  - editable cell grid
  - row number rail
  - add row / add column actions in node chrome
  - remove-row action column
  - remove-column controls in the header
- template full mode includes:
  - textarea editing
  - detected placeholder chips
  - connected-list column chips that insert `[[Column Name]]`
  - inline compatibility warnings
  - live merge preview rows
- template full mode uses a two-zone layout with the editor on the left and compatibility/merge preview in a contained side rail
- active-node phantom previews:
  - appear only when exactly one source node is active
  - show likely downstream outputs without persisting real nodes
  - use dotted/low-opacity output connections
  - pin the run launcher near the source output edge
- active template nodes suppress external phantom row cards while they are in `full` mode and rely on the inline merge preview instead
- multi-selection compare/download actions live in a floating selection strip near the current selection instead of the old bottom bar
- canvas keyboard shortcuts when focus is not inside an input, textarea, select, or contenteditable surface:
  - `A` opens the add-to-canvas insert menu at viewport center
  - `C` connects exactly two selected nodes from oldest selected -> newest selected
  - `Enter` opens inline full mode for a single selected node
  - `Cmd/Ctrl+D` duplicates the single selected node
  - `Delete` / `Backspace` removes the selected node(s) or selected connection
  - `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` undo/redo scoped canvas changes
  - `Escape` closes insert menus, popovers, and connection selection
- undo/redo scope:
  - included: add, delete, duplicate, connect/disconnect, batch move, clear inputs, inline text/settings edits, mode changes, resize commits, list edits, template text edits, generate-template-rows
  - excluded: viewport pan/zoom, queue state changes, polling-driven generated output hydration, and async placeholder reconciliation

## Queue Feedback
- running jobs show queue state in the queue view and on generated output nodes
- OpenAI image jobs can show persisted preview frames before final completion
- successful image jobs hydrate output nodes with final assets
- successful GPT text jobs hydrate generated nodes by output target:
  - `Text Note` -> generated text note
  - `List` -> generated list node
  - `Template` -> generated template node
  - `Smart Output` -> one or more unconnected generated nodes
- model-spawned list/template/note nodes keep source-job provenance but remain editable after hydration
- template/list pairs show live inline merge preview before generation; those previews do not create real output nodes until run

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
