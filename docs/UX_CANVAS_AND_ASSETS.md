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
  - top-right queue pill
  - full-width bottom settings bar inset from the viewport edges by the same 14px chrome spacing as the menu pill
  - upload remains available from the insert menu rather than a dedicated floating button

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
  - add list node
  - add text template
  - upload assets from the insert picker
  - add previous generated assets from project library
  - add previous uploaded assets from project library
  - drag/move node cards
  - connect nodes from either port direction; canvas normalizes the final source/target relationship
  - drag a text-note or asset output onto empty canvas to create a new model node already connected to that source
  - drag a list output onto empty canvas to create a new text-template node already connected to that list
  - drag a model input onto empty canvas to open an input-scoped insert menu (`text note`, `upload`, `generated asset`, `uploaded asset`) that auto-connects the chosen source into that model
  - drag a text-template input onto empty canvas to open an input-scoped insert menu (`list`) that auto-connects the chosen source into that template
  - click a connection line to select it
  - delete the selected connection with `Delete` / `Backspace`
  - delete the active node selection with `Delete`/`Backspace`
  - duplicate exactly one selected node with `Cmd/Ctrl + D`
  - run from the bottom settings bar
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
- Canvas graph visuals are media-semantic rather than provider-semantic:
  - text connections/ports use neon pink
  - image connections/ports use neon blue
  - video connections/ports use neon orange
  - generated image placeholders use a citrus-led shell while processing
  - generated output frame borders stay citrus on the left, use the output-type color on the right, and blend across the top edge while the job is active
  - model-to-generated-output connections and model output nipples use citrus rather than the media-type color
- Port hit targets are intentionally larger than the visible nipple so connector drags are easy without visually bloating the node.

## Node Configuration UX
- Node settings live in the fixed bottom settings bar.
- The bottom bar appears only when one or more nodes are selected:
  - single selection => compact node controls plus single-image view action when applicable
  - multi-selection => compare-focused actions only
- Single-selection bars do not show a node-type chip; multi-selection uses a generic `N selected` chip.
- Text notes are first-class canvas nodes with inline editing plus bottom-bar tray editing.
- List nodes are first-class canvas nodes with on-canvas table preview plus bottom-bar table editing.
- Text-template nodes are first-class canvas nodes with on-canvas merge summary plus bottom-bar template editing.
- Connected text notes act as prompt-source nodes for model execution.
- Single-selection node controls include:
  - provider selector
  - model selector
  - prompt / note-body editing in an upward tray
  - schema-driven model parameter controls
    - core controls always visible inline in the bar
    - advanced controls in an upward tray
  - connection and run-readiness detail in an upward tray
  - run controls
  - API call preview for the normalized request payload in an upward tray
  - generated-asset source-call inspection in an upward tray plus a Queue deep link
- All select-like controls in the canvas bar use custom upward-opening popovers rather than native browser selects.
- Input/output ports display supported media types.
- Text notes expose output-only prompt-source connections into model nodes.
- List nodes expose output-only list/text connections into text-template nodes.
- Text-template nodes expose input-only list connections, then materialize new text-note outputs on run.
- Image-backed nodes preserve original asset aspect ratio inside the canvas preview.
- Image-backed nodes size the entire card from the image ratio itself rather than letterboxing into a shared card shape.
- Generated output nodes can show a streamed partial preview before the final asset lands.
- Generated image nodes reserve their expected final frame size immediately:
  - explicit aspect-ratio settings shape the placeholder before the first preview
  - `auto` in edit mode inherits the first connected image-input aspect ratio
  - `auto` without image inputs starts square until the first preview/final image determines the real ratio
- Canvas-selected nodes use a semantic halo that follows the same color logic as the node border:
  - text notes glow pink
  - uploaded assets glow blue
  - generated outputs glow citrus-to-output-color
  - model pills use the same left/right semantic border split in the selected halo
- Canvas node chrome uses squared corners rather than rounded cards/pills.
- Canvas nodes use one unified 4px semantic outer border; image/text/model cards should not render secondary inset frames or double-border treatments.
- Connection nipples stay hidden until a node is hovered, selected, or actively participating in a connection interaction.
- Model nodes only expose their output nipple after that model has started at least one job; before first run they are input-only.
- Validation appears before run when required ports/settings are missing.
- Model execution rules in this pass:
  - `openai / gpt-image-1.5` and `openai / gpt-image-1-mini` are the runnable OpenAI image models
  - unavailable models remain selectable in the picker, show `Coming soon`, and still disable Run
  - connected text note overrides the model prompt field during execution
  - model prompt field remains as fallback when no text note is connected
  - OpenAI execution mode is inferred automatically from connected inputs
  - no connected image inputs => prompt-only generation
  - one or more supported connected image inputs => reference-image generation
  - OpenAI image-model core controls:
    - aspect ratio (`Auto`, `Square`, `Portrait`, `Landscape`)
    - resolution (`Auto`, `Low`, `Medium`, `High`)
    - transparency (`Auto`, `Opaque`, `Transparent`)
    - format (`PNG`, `JPEG`, `WebP`)
    - outputs (`1..4`)
  - OpenAI image-model advanced controls:
    - input fidelity (`edit` only, values vary by selected model)
    - compression (`jpeg` / `webp` only)
    - moderation (`generate` only)
  - all placeholder models/providers remain selectable but show `Coming soon` and disable Run
- Text-template execution rules in this pass:
  - exactly one connected list node
  - placeholder syntax is `[[column label]]`
  - column matching is case-insensitive after trimming/collapsing whitespace
  - missing columns block generation
  - blank cells render as empty strings
  - fully blank rows are skipped
  - generation is local/canvas-only and creates new text-note nodes, not queue jobs

## Job Feedback UX
- Queue summary remains visible from canvas via the top-right queue pill.
- Run action creates a project job entry with state and timestamps in the queue view.
- Run also inserts one or more generated output placeholder nodes immediately to the right of the model node.
- Text-template generation does not create queue rows; it appends new text-note outputs directly on the canvas.
- Job-state badge lives on that output node, not on the model node.
- Completed generated outputs clear their badge; failed outputs stay on canvas with failed state.
- Generated model->output edges are dashed only while the output node is processing, then become solid once the output completes.
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
  - from canvas bottom settings bar when selected nodes resolve to image assets
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

## Canvas Card Styling
- Image nodes are image-first:
  - single 4px semantic outer border
  - no bevel/inset treatment
  - no large title overlay
  - simplified footer shows source label/model name plus output type on hover/selection
  - generated image nodes keep the citrus-to-output-color border treatment until generation completes
  - uploaded asset nodes use a pure image-blue frame
- Text notes use a solid neon-pink frame so prompt inputs are distinct even before reading their connection lines.
  - on-canvas text notes only show the note body/value; label and note metadata stay in the bottom-bar tray system
- List nodes use the same text-pink semantic family, with a compact header-plus-grid preview.
- Text-template nodes use the same text-pink semantic family, with a short merge-text preview and readiness summary.
- Model cards are slightly taller, bright white, and visually reflect data flow:
- Model nodes render as compact semantic pills rather than large content cards:
  - the model name is the primary canvas label
  - a title only appears when the node has a user-customized label
  - untitled model pills vertically center the model name to stay visually compact
  - provider, model status, and other configuration details live in the bottom-bar controls rather than on the canvas
  - left-edge border coloration mirrors the connected input media types
  - right-edge border and output nipple are citrus as soon as the model has a connected output node and remain white before that
  - generated-output edges from the model stay citrus while running and after completion
  - mixed input-type borders use a quadrant split on the left side: upper-left pink for text, lower-left blue for image, then blend into citrus across the entire right half with short transition bands
  - model card interiors stay flat white; the semantic border carries the color system rather than interior glow spreads
  - model borders render as explicit edge layers so compact pills keep a clean top blend in both titled and untitled states

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
