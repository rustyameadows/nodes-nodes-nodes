# UX Spec: Canvas and Asset Viewer (V1)

## Workspace Shell
- Full-viewport canvas is the primary workspace.
- Route-scoped workspace views:
  - `/projects/[projectId]/canvas`
  - `/projects/[projectId]/assets`
  - `/projects/[projectId]/queue`
  - `/projects/[projectId]/settings`
- Canvas route keeps only minimal floating chrome:
  - top-left `Menu`
  - bottom-right queue pill
  - upload CTA above queue pill
  - bottom selection bar when one or more nodes are selected
  - draggable node settings modal when exactly one node is selected

## Project-Aware Behavior
- Exactly one project open at any time.
- Opening another project swaps the entire workspace context.
- Workspace restore includes canvas viewport, node selection, and viewer layout/filter state.

## Infinite Canvas (Custom Engine)
- Canvas supports pan/zoom and large graph layouts.
- Node operations:
  - add node by double-clicking the canvas
  - drag/move node cards
  - connect node output port to another node input port
  - upload assets by CTA or file drop onto canvas
  - delete the active node selection with `Delete`/`Backspace`
  - run from node modal
- Selection behavior:
  - click selects one node
  - `Shift`/`Cmd`/`Ctrl` click toggles node membership in the current selection
  - `Shift + drag` creates a marquee selection rectangle
  - marquee interaction must suppress native browser text selection while active
- Zoom behavior:
  - wheel zoom remains cursor-centered
  - trackpad pinch stays inside canvas and must not trigger browser page zoom
- Node state indicators:
  - idle
  - queued
  - running
  - success
  - failed
  - canceled

## Node Configuration UX
- Node settings live in the draggable canvas modal and only appear for a single selected node.
- Node modal includes:
  - provider selector
  - model selector
  - output type
  - prompt
  - settings panel generated from `settingsSchema`
  - run controls
  - API call preview for the normalized request payload
- Input/output ports display supported media types.
- Image-backed nodes preserve original asset aspect ratio inside the canvas preview.
- Canvas-selected nodes use a high-visibility citrus selection border/glow.
- Canvas node chrome uses squared corners rather than rounded cards/pills.
- Validation appears before run when required ports/settings are missing.

## Job Feedback UX
- Queue summary remains visible from canvas via the bottom-right queue pill.
- Run action creates a project job entry with state and timestamps in the queue view.
- Failed jobs show normalized error class and short detail.
- Users can retry failed jobs or cancel running jobs when supported.
- Queue rows support source-call inspection for provider request/response debugging.

## Asset Viewer Modes
- `grid`: regular row/column thumbnail grid using contain-fit previews without cropping.
- `2-up`: side-by-side comparison view for two selected assets at full aspect ratio.
- `4-up`: tiled comparison view for four selected assets at full aspect ratio.
- `single`: dedicated single-asset viewer with metadata panel and source-call deep link when available.

## Asset Curation Controls
- Rating: 1-5 stars.
- Flagging: boolean pick/reject marker.
- Tags: attach and filter by tag labels.
- Sorting: newest, oldest, highest rating.
- Filtering: type, rating range, flagged, tag set, provider/model.

## Selection and Compare Rules
- Selection is project-scoped.
- Compare entry points:
  - from canvas selection bar when selected nodes resolve to image assets
  - from asset grid selection
  - choose exactly 2 assets for 2-up
  - choose exactly 4 assets for 4-up
- Invalid selection counts show inline guidance.

## Keyboard Shortcuts (Proposed V1)
- Canvas:
  - background drag: pan
  - wheel / trackpad pinch: zoom
  - `Shift + drag`: marquee-select nodes
  - `Delete` / `Backspace`: remove selected nodes
- Asset viewer:
  - `1..5`: set star rating
  - `F`: toggle flag
  - `G`: grid mode
  - `2`: compare 2-up mode
  - `4`: compare 4-up mode

## Accessibility
- All actionable controls keyboard reachable.
- Focus ring visible on interactive elements.
- High-contrast state indicators for job status.
- Text alternatives for visual-only status badges.

## Performance Targets
- Smooth pan/zoom on large canvases typical for local workflows.
- Filter and sort operations should feel immediate on typical project asset sets.
- Mode switching (grid/2-up/4-up) should not require page reload.
