# UX Spec: Canvas and Asset Viewer

## Workspace Views
- `/`
  - launcher or redirect to the current project
- `/projects/$projectId/canvas`
- `/projects/$projectId/assets`
- `/projects/$projectId/assets/$assetId`
- `/projects/$projectId/queue`
- `/projects/$projectId/settings`

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
- insert actions for:
  - model node
  - text note
  - list node
  - text template
  - native asset import
  - generated asset pointer
  - uploaded asset pointer
- macOS native `Canvas` menu mirrors the primary node insert actions:
  - add model node
  - add text note
  - add list node
  - add text template
- native canvas insertions land at the current viewport center with a small stagger and use the same save/selection path as the insert popup
- bottom settings bar remains the main node-configuration surface

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
- browser uploads are replaced by native file dialogs
- asset and preview rendering uses `app-asset://` URLs
- renderer never sees raw local file paths
- queue/state updates arrive through preload events and TanStack Query invalidation
