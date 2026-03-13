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
- Consequence: undo/redo covers user-initiated canvas graph edits and inline node edits only, and resets when the canvas view is reloaded or the session changes.

## 2026-03-08 - Desktop Data Path Is Pinned Independently From Branding
- Decision: pin Electron `userData` to a stable on-disk directory instead of letting it follow the display name.
- Rationale: Electron defaults `userData` from the app name, and a branding-only rename should never make the app look blank or silently switch SQLite/assets folders.
- Consequence: the packaged app name can change without moving live local data, and the macOS data root intentionally stays at the compatibility path `~/Library/Application Support/Nodes Node Nodes/node-interface-demo`.

## 2026-03-08 - Startup Lands On App Home
- Decision: route desktop startup to a persistent app-level home view instead of auto-opening the last project route.
- Rationale: a visible project picker is a better top-level desktop pattern now that the app supports multiple local projects plus app-level settings.
- Consequence: `/` always renders app home, project picking moves onto a dedicated grid/list screen, and the open-project marker remains metadata rather than startup routing state.

## 2026-03-08 - Text Models Emit Structured Generated Nodes
- Decision: let runnable OpenAI text models target `Text Note`, `List`, `Template`, or `Smart Output` instead of hardcoding model text responses to generated notes only.
- Rationale: issue `#22` needs model text runs to become useful downstream graph inputs, and the renderer should not infer node types by parsing raw provider text.
- Consequence: the app now injects strict JSON schema plus instructions for structured targets, parses generated-node descriptors in the worker, falls back to one generated note on parse failure, and hydrates model-spawned note/list/template nodes from serialized descriptor metadata.

## 2026-03-08 - Canvas Shortcuts Use TanStack Hotkeys
- Decision: move canvas keyboard shortcuts off manual `window` listeners and onto TanStack Hotkeys with input ignoring enabled.
- Rationale: the canvas needs keyboard shortcuts to stay active on the route while reliably shutting off inside text inputs, list editors, and other editable surfaces.
- Consequence: canvas hotkeys are declarative, route-scoped through `CanvasView`, and no longer rely on custom editable-target detection to avoid stealing typed characters.

## 2026-03-08 - Canvas Nodes Edit Inline
- Decision: move node editing out of the old bottom-bar flow and into adaptive inline node surfaces with `preview`, `compact`, transient `full`, and persisted `resized` presentation states.
- Rationale: issue `#44` needs the canvas to feel flexible and customizable, and issue `#24` needs templates/list pairing to be inspectable and editable directly where the node lives.
- Consequence: `CanvasView` now persists node-local presentation metadata inside the canvas document, full-node editing uses header-only drag chrome, template compatibility/merge preview lives inline, and phantom output previews plus the edge-mounted run launcher are renderer-only affordances instead of persisted nodes.

## 2026-03-08 - List Full Mode Uses An Inline Sheet
- Decision: implement full/resized list nodes as an inline spreadsheet-like sheet backed by TanStack Table instead of reusing the old stacked form controls.
- Rationale: issue `#19` needs list editing to feel like a real sheet on the canvas, and the adaptive-node cleanup pass showed that simply transplanting the old controls into full mode was not good enough.
- Consequence: list preview stays lightweight, but full/resized list nodes now render a real editable grid with header edits, cell edits, row numbering, and node-chrome add/remove actions.

## 2026-03-08 - Generated Outputs Spawn Once And Then Stop Syncing
- Decision: treat generated text, list, template, and image outputs as one-time spawned child nodes instead of live-managed job outputs after insertion.
- Rationale: users need generated child nodes to behave like normal canvas nodes once they exist, including keeping edits, size changes, and deletions without being rewritten by later job polls.
- Consequence: the canvas document now records consumed generated-output receipt keys, pending placeholders/previews are limited to unresolved jobs, completed outputs append new children once, and provenance remains metadata only for source/debug UI.

## 2026-03-08 - Node Metadata Lives In A Canonical Registry
- Decision: centralize built-in node metadata in a canonical node registry that drives the Node Library, insert picker, native add menus, searchable model selection, and structured-output node summaries.
- Rationale: the app needs one source of truth for what node types exist, how they should be presented to users, and how downstream systems should reason about them.
- Consequence: UI/catalog/prompt metadata now flows from `src/lib/node-catalog.ts`, while actual node creation and mutation still stays in the existing canvas/workspace logic.

## 2026-03-09 - Gemini Access Uses Discovery Plus Runtime Enforcement
- Decision: expose Gemini model availability through a hybrid of static billing hints, authenticated Gemini model discovery, and runtime error classification instead of asking the user to pick a free vs paid tier.
- Rationale: Google exposes `models.list()` for authenticated discovery, but the app still needs runtime truth for billing, permission, quota, and rate-limit failures that can change independently of the saved key field.
- Consequence: App Settings and the model picker show honest per-model Gemini access states, unavailable models stay visible but disabled, and worker-side Gemini failures can update cached provider access state without rewriting the saved node graph.

## 2026-03-09 - The Design System Uses Light App Surfaces And Protected Dark Canvas Overlays
- Decision: introduce a lightweight token/CSS-variable/component design system with two surface contexts: light `app` surfaces for non-canvas views and dark `canvas-overlay` chrome above the canvas.
- Rationale: issue `#59` needs a coherent desktop shell without flattening the specialized node/canvas rendering language or repainting the protected black canvas.
- Consequence: app home, Node Library wrappers, settings, assets, queue, shell menu, insert picker, bottom-bar popovers, and selection action strip now share one tokenized system, while main canvas nodes/connections and the Node Library playground canvas internals stay visually and structurally protected.

## 2026-03-09 - Canvas Nodes Move Into A Dedicated Node Design System
- Decision: extend the design-system work into the canvas with a dedicated node-card layer instead of leaving node renderers permanently outside the system.
- Rationale: issue `#62` needs the five core node families to share durable rails, actions, resizing, and spreadsheet/editor patterns without repainting the semantic canvas palette or turning node work into ad hoc per-issue CSS.
- Consequence: canvas nodes now use shared node tokens plus shared node chrome/action primitives, template edit mode stays explicit, node double-click reframes the viewport after any size-changing mode transition settles, and the Node Library playground stays on the same renderer path as the real project canvas.

## 2026-03-09 - Canvas Node Chrome Uses Explicit External Slots
- Decision: standardize node chrome around external title, utility, caption, and action slots instead of ad hoc per-node absolute positioning.
- Rationale: the post-issue-62 polish pass needs image labels/actions outside the media frame, centered title rails, inline template pills, and list controls that stop participating in table layout.
- Consequence: the shared node renderer now owns top utility and footer rails, image nodes keep all chrome outside the image surface, template preview variables render inline, and list add/remove controls are overlay affordances rather than content-bearing cells.

## 2026-03-09 - Canvas Copilot Reuses Structured Text Jobs Instead Of Hidden Nodes
- Decision: implement the first copilot/chat surface as a canvas-overlay widget that submits normal text-generation jobs with a first-class `copilot` run origin instead of creating a hidden model node.
- Rationale: issue `#49` needs a lightweight generate-to-canvas assistant, but a hidden node would blur provenance, duplicate smart-output parsing rules, and make hydration brittle.
- Consequence: the canvas now has a session-only copilot pill/panel, smart-output descriptors carry stable IDs plus optional generated connections, and the renderer inserts copilot-generated nodes near the viewport center while keeping the existing queue/job pipeline intact.

## 2026-03-09 - Uploaded Asset Nodes Carry Explicit Upload Metadata
- Decision: treat uploaded canvas asset nodes as first-class uploaded sources with explicit node-local upload metadata instead of deriving their labels and aspect ratios from fallback provider/model fields.
- Rationale: mac canvas uploads and menu bar imports need one durable insertion path, and uploaded assets should not inherit generated-image labeling or lose their real aspect ratio after reload.
- Consequence: uploaded asset-source nodes now persist `source: "uploaded"` plus `assetName`, `assetWidth`, and `assetHeight`, native file dialog imports preserve source names through the desktop bridge, uploaded image captions/sizing prefer uploaded metadata over fallback provider/model ids, and the renderer still accepts legacy `source: "upload"` nodes for backwards compatibility.

## 2026-03-10 - Gemini Uses Curated Model-Aware Settings
- Decision: replace the old globally minimal Gemini settings surface with model-aware profiles that expose a curated subset of official Gemini controls.
- Rationale: Google’s current Gemini API docs and the installed SDK already support meaningful text and image configuration, and the app’s provider-parameter plumbing can render those controls once the registry advertises them honestly.
- Consequence: Gemini text nodes now expose shared sampling plus family-specific thinking controls, Gemini image nodes expose shared generation controls plus model-specific `imageSize`, `thinkingLevel`, and `outputMode` where supported, the browser preview registry stays aligned with the runtime registry, and broader Gemini knobs remain intentionally omitted until the canvas UX has a clearer need for them.

## 2026-03-10 - Mixed Gemini Image Jobs Use Output-Driven Hydration
- Decision: treat `Nano Banana 2` `Images & Text` runs as one mixed-output job that produces every returned generated image asset plus any returned `Smart Output` text descriptors, and hydrate completed outputs by actual persisted output kind instead of only by `nodeRunPayload.outputType`.
- Rationale: Gemini 3.1 image runs can return image bytes and useful structured text together, and the canvas cannot leave a receipt-consumed generated image node blank just because an earlier placeholder snapshot persisted.
- Consequence: the Gemini image adapter now emits all returned image parts plus any smart-text output from the same response, the worker trusts text output metadata for structured parsing, canvas receipt reconciliation repairs stale generated-image placeholders in place when the matching asset already exists, root smart descriptors stay anchored to the source model unless generated wiring already targets them, and model-spawned outputs now materialize from the same visible-edge anchor used by the phantom preview.

## 2026-03-10 - Nano Banana 2 Mixed Output Stays Provider-Authentic And Experimental
- Decision: keep `Nano Banana 2` `Images & Text` as a single Gemini provider call with no app-level fallback text call, and treat image-only mixed results as successful provider-authentic outcomes.
- Rationale: live runs on March 10, 2026 showed the same request harness sometimes returns `["image","text"]` and sometimes `["image"]`, especially on reference-image edit runs, so the correct short-term contract is best-effort observability rather than synthesized determinism.
- Consequence: mixed Gemini attempts now persist typed diagnostics when text is missing, queue inspection explains “Gemini returned image-only” directly, and job serialization can reparse stored smart text outputs if descriptor arrays are absent in the attempt payload.

## 2026-03-10 - Queue Debugging Uses A Dense Ledger Plus Full Record
- Decision: keep `/queue` as a dense run ledger and move rich job diagnostics entirely into the dedicated `/queue/$jobId` execution-record route.
- Rationale: the list page is for scanning and selecting runs, while provider payloads, media previews, reconciliation counts, and raw JSON belong in one focused diagnostics surface instead of a side summary pane.
- Consequence: queue rows open the full record directly, legacy `?inspectJobId=` links redirect to the detailed route, and the queue list now optimizes for high-density debugging columns instead of inline summary cards.

## 2026-03-10 - Asset Review Uses Grid Curation Plus Square Inspection Stages
- Decision: keep filters editable only in asset grid mode, and treat `2-up`, `4-up`, and single-asset viewing as cleaner square-corner inspection stages without helper copy or filter rails.
- Rationale: the old asset library felt like a decorative gallery, buried uploaded-vs-generated state, and let keyboard shortcuts fire while typing tags, which made review slower and less trustworthy.
- Consequence: asset cards now show uploaded/generated origin directly, rating/flag/tag controls collapse into a compact hover/focus utility rail, compare stages share one ratio-safe gray canvas with divider lines, single-asset viewing matches that language, and asset hotkeys are suppressed inside editable fields.

## 2026-03-10 - Asset Review Always Loads Unfiltered
- Decision: ignore persisted asset-view filter state when opening the Assets route and reset any stale saved filter payloads back to the default unfiltered state.
- Rationale: restrictive saved filters like `providerId = topaz` make the library look incomplete and break the core debugging expectation that opening Assets should show every project asset immediately.
- Consequence: asset layout still persists, but the asset grid now always boots with `all` origin/type/provider and no tag/rating/flag constraints, while stale workspace filter snapshots are cleared on first hydrate.

## 2026-03-11 - Canvas Stacking Order Persists In The Document
- Decision: canvas nodes now carry a persisted `zIndex`, focusing/selecting a node promotes it to the front by updating that saved order, and insert-picker creation still centers the new shell on the requested canvas coordinate.
- Rationale: temporary selection-only layering makes overlap debugging feel unstable because the node drops back under neighbors as soon as focus changes, while users expect "bring to front" to stay exactly where they last saw it.
- Consequence: saved canvas documents now preserve node stacking order across deselection and reload, newly created nodes spawn at the front by default, and overlap behavior is driven by document state rather than transient CSS-only selected styling.

## 2026-03-11 - Canvas Border Semantics Use Operator Provenance And Red Failure Output
- Decision: rename the purple canvas semantic from `function` to `operator`, treat templates as the first operator node family, resolve border accents through one shared provenance-aware helper, and reserve red as a right-edge-only failed-output semantic.
- Rationale: "generator" is too ambiguous once model nodes also generate outputs, while ad hoc per-node border logic makes template/model/generated states drift and makes failure styling hard to extend.
- Consequence: fresh template nodes stay neutral until they have downstream output, operator-produced children carry purple on the left edge, model-produced children carry citrus on the left edge, failed nodes keep their normal left-edge provenance/input accents while forcing the right edge red, and queued/running generated outputs shimmer until they settle.

## 2026-03-11 - Resized Canvas Nodes Use Hard Stored Dimensions
- Decision: treat `displayMode: "resized"` as an authoritative stored frame size, allow model `full` shells to auto-measure content height, and lower the list resize floor to the compact list footprint.
- Rationale: users expect a manual resize to stick exactly as set, but auto-height models were collapsing after focus changes and the old list minimum prevented dense spreadsheet nodes.
- Consequence: resized model nodes now keep their saved width and height with internal scrolling for overflow, keep their expanded editor chrome/body visible even when selection moves away, model `full` shells still open with adaptive height behavior, and resized lists can shrink to compact-size shells without disappearing.

## 2026-03-11 - Model Full Mode Is Explicit Instead Of Selection-Driven
- Decision: stop promoting preview and compact model nodes into transient `full` mode on single selection, and reserve model full-mode entry for explicit primary-editor gestures.
- Rationale: model nodes should align with the other canvas node families, where selection reveals chrome but does not silently change the node’s size or body layout.
- Consequence: single-click model selection now keeps the persisted preview/compact shell while showing the shared rails and external side run launcher, while double-click and keyboard `Enter` open the full response-settings editor; that full shell stays open across focus changes until `Default`, `Compact`, or resize mode takes over; selected preview/full/resized model shells expose the bottom-right resize handle; resize switches into persisted `displayMode: "resized"` at drag start so the node stops fitting to content immediately; and only `Default` or `Compact` clear that persisted resized state.

## 2026-03-11 - Model Full Mode Is Persisted On The Node
- Decision: persist model `full` mode directly in `WorkflowNode.displayMode` instead of tracking one globally pinned full-model id.
- Rationale: a single global full-model slot caused the previously opened model shell to collapse when another model was opened, even though users expect each model node to keep its last chosen presentation state.
- Consequence: model nodes now own `preview`, `compact`, `full`, or `resized` as node-local state; multiple model nodes may remain in `full` at the same time; inserted model nodes can land directly in `full`; and reloading the canvas restores those full model shells without needing a transient renderer flag.

## 2026-03-11 - Node Library Display Modes Use A Canvas-Side Primary-Node Controller
- Decision: move Node Library detail display-mode switching out of the metadata rail and into a bottom-centered canvas overlay that controls one explicit primary fixture node.
- Rationale: the old left-rail badges described modes but did not let users compare shells quickly, while the library needs a fast, unfocused way to flip the real renderer between compact, preview, edit/full, and resized states.
- Consequence: every Node Library detail fixture now declares a `primaryNodeId` plus a curated resized preset, the right-side playground renders a bottom mode row with `Compact`, `Preview`, `Edit`, and `Resize`, the row drives library-only full-mode overrides without changing real canvas behavior, and primary demo nodes stay centered as their shell sizes change; those library-only mode changes now animate node shell layout and viewport reframing together instead of using a delayed recenter correction.

## 2026-03-11 - Canvas Focus Uses Shared Bounds-Based Fit Zoom
- Decision: replace the separate real-canvas and Node Library focus math with one shared centering engine that fit-zooms from outer rendered node bounds, current surface size, and caller-provided safe insets.
- Rationale: fixed per-surface focus padding and duplicate framing logic made repeated mode transitions drift into clipped or over-zoomed views, especially after switching a library node back into larger shells.
- Consequence: Node Library load and mode switches, workspace double-click focus, workspace top-rail `Default` / `Compact` mode changes, the single-node `Center` CTA, and multi-node `Center Selection` now share one union-bounds viewport target calculation; deterministic shells use authored target sizes directly, content-fit shells preflight-measure a hidden copy before the visible move begins, size-changing single-node actions re-anchor from the live available viewport center instead of reusing the node's previous world-space center, and measured outer shell bounds only validate that prediction inside the same motion window instead of issuing a second visible recenter later.

## 2026-03-11 - Node Library Index Uses A Specimen-First Gallery
- Decision: rebuild `/nodes` as a quiet gallery of real node specimens instead of a metadata-heavy registry page.
- Rationale: the old hero, metrics, and badge-heavy cards competed with the actual node shapes and made the library read like docs instead of a focused browse surface.
- Consequence: the index now keeps only a compact title/search header plus home navigation, every card centers the fixture's primary node inside a dark mini-canvas stage using the shared node-render shaping path, and deeper I/O/settings/display-mode explanation remains on the detail pages rather than the gallery index.


## 2026-03-13 — App-level feature flags in App Settings
- Context: We need a durable way to incrementally roll out settings-page-controlled behavior without hard-coding temporary checks in canvas code.
- Decision: add a persisted app-settings singleton with typed feature flags and expose toggles in `/settings/app`.
- Initial flags: `capturePng` and `canvasNodeCleanup` gate the corresponding canvas selection-rail actions.
- Consequence: rollout and rollback are immediate for local users, flags survive restarts, and future toggles can reuse the same path (IPC → service → `app_settings`).
