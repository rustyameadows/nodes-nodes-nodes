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
  - open insert picker by double-clicking empty canvas
  - add model node
  - add text note
  - upload assets from insert picker or upload CTA
  - add previous generated assets from project library
  - add previous uploaded assets from project library
  - drag/move node cards
  - connect nodes from either port direction; canvas normalizes the final source/target relationship
  - click a connection line to select it
  - delete the selected connection with `Delete` / `Backspace`
  - delete the active node selection with `Delete`/`Backspace`
  - duplicate exactly one selected node with `Cmd/Ctrl + D`
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
  - queued
  - running
  - failed
  - completed outputs clear the badge and simply show the final asset
- Port hit targets are intentionally larger than the visible nipple so connector drags are easy without visually bloating the node.

## Node Configuration UX
- Node settings live in the draggable canvas modal and only appear for a single selected node.
- Text notes are first-class canvas nodes with inline editing plus modal editing.
- Connected text notes act as prompt-source nodes for model execution.
- Node modal includes:
  - provider selector
  - model selector
  - output type
  - schema-driven model parameter controls
    - core controls always visible
    - advanced controls behind a toggle
  - prompt
  - run-state helper that explains why the node is or is not runnable
  - run controls
  - API call preview for the normalized request payload
- Input/output ports display supported media types.
- Text notes expose output-only prompt-source connections into model nodes.
- Image-backed nodes preserve original asset aspect ratio inside the canvas preview.
- Generated output nodes can show a streamed partial preview before the final asset lands.
- Canvas-selected nodes use a high-visibility citrus selection border/glow.
- Canvas node chrome uses squared corners rather than rounded cards/pills.
- Validation appears before run when required ports/settings are missing.
- Model execution rules in this pass:
  - `openai / gpt-image-1.5` is the only runnable model
  - connected text note overrides the model prompt field during execution
  - model prompt field remains as fallback when no text note is connected
  - OpenAI execution mode is inferred automatically from connected inputs
  - no connected image inputs => prompt-only generation
  - one or more supported connected image inputs => reference-image generation
  - GPT Image 1.5 core controls:
    - aspect ratio (`Auto`, `Square`, `Portrait`, `Landscape`)
    - resolution (`Auto`, `Low`, `Medium`, `High`)
    - transparency (`Auto`, `Opaque`, `Transparent`)
    - format (`PNG`, `JPEG`, `WebP`)
    - outputs (`1..4`)
  - GPT Image 1.5 advanced controls:
    - input fidelity (`edit` only)
    - compression (`jpeg` / `webp` only)
    - moderation (`generate` only)
  - all placeholder models/providers remain selectable but show `Coming soon` and disable Run

## Job Feedback UX
- Queue summary remains visible from canvas via the bottom-right queue pill.
- Run action creates a project job entry with state and timestamps in the queue view.
- Run also inserts one or more generated output placeholder nodes immediately to the right of the model node.
- Job-state badge lives on that output node, not on the model node.
- Completed generated outputs clear their badge; failed outputs stay on canvas with failed state.
- Failed jobs show normalized error class and short detail.
- Users can retry failed jobs or cancel running jobs when supported.
- Queue rows support source-call inspection for provider request/response debugging.
- Generated output nodes expose inline `Show Source Call` inspection plus a Queue deep link.
- Successful OpenAI image jobs update the existing placeholder output nodes in place rather than creating second nodes on completion.
- While a job is `running`, output nodes render the latest durable preview frame available for that `(jobId, outputIndex)`.
- Reloading during a run restores those preview frames from durable job-preview records.

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

## Asset Pointer Nodes
- The insert picker exposes:
  - `Add Generated Asset`
  - `Add Uploaded Asset`
- Both open the same compact library picker with:
  - origin-prefiltered results
  - newest-first ordering
  - text search
  - multi-select spawning
- Spawned asset nodes are peer pointers to existing assets:
  - no asset duplication
  - no master/child hierarchy
  - any generated-asset pointer still exposes source-call inspection

## Keyboard Shortcuts (Proposed V1)
- Canvas:
  - background drag: pan
  - wheel / trackpad pinch: zoom
  - `Shift + drag`: marquee-select nodes
  - `Cmd/Ctrl + D`: duplicate selected node
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
