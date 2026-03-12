# Data Model (SQLite V1)

## Principles
- One local user.
- Multiple isolated projects.
- Exactly one canvas per project in v1.
- SQLite stores metadata; filesystem stores asset and preview binaries.
- Provider/model IDs stay stable and separate from display names.
- Canvas nodes and edges live inside one JSON canvas document, not relational node/edge tables.

## Core Types

```ts
type ProjectStatus = "active" | "archived";
type JobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
type AssetType = "image" | "video" | "text";

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

type ProjectWorkspaceState = {
  projectId: string;
  isOpen: boolean;
  viewportState: Record<string, unknown> | null;
  selectionState: Record<string, unknown> | null;
  assetViewerLayout: "grid" | "compare_2" | "compare_4";
  filterState: Record<string, unknown> | null;
  updatedAt: string;
};

type Canvas = {
  projectId: string;
  canvasDocument: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
};

type WorkflowNodeDisplayMode = "preview" | "compact" | "full" | "resized";

type WorkflowNodeSize = {
  width: number;
  height: number;
};

type WorkflowNode = {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  displayMode: WorkflowNodeDisplayMode;
  size: WorkflowNodeSize | null;
  // ...existing provider, prompt, source, and connection fields
};

type UploadedAssetNodeSettings = {
  source: "uploaded";
  assetName?: string;
  assetWidth?: number | null;
  assetHeight?: number | null;
};

type GeminiNodeSettings = {
  textOutputTarget?: "note" | "list" | "template" | "smart";
  maxOutputTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  stopSequences?: string | null;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  thinkingBudget?: number | null;
  outputMode?: "images_and_text" | "images_only";
  aspectRatio?: "auto" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
  imageSize?: "512" | "1K" | "2K" | "4K";
};

type Job = {
  id: string;
  projectId: string;
  state: JobState;
  providerId: string;
  modelId: string;
  nodeRunPayload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  availableAt: string;
  claimedAt: string | null;
  claimToken: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Asset = {
  id: string;
  projectId: string;
  jobId: string | null;
  type: AssetType;
  storageRef: string;
  mimeType: string;
  outputIndex: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
};

type ImportedAssetResult = {
  asset: Asset;
  sourceName: string | null;
};

type JobPreviewFrame = {
  id: string;
  jobId: string;
  outputIndex: number;
  previewIndex: number;
  storageRef: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
};
```

## SQLite Tables

### `projects`
- top-level project record
- one row per project

### `project_workspace_states`
- one row per project
- stores open-state plus asset-viewer layout/filter state

### `canvases`
- one row per project
- stores the full canvas JSON document plus a version counter
- the canvas JSON now persists node-local presentation metadata:
  - `displayMode`
  - `size`
- the canvas JSON also persists `generatedOutputReceiptKeys`, which record completed generated job outputs that have already been materialized onto the canvas
- template edit/full state and phantom previews remain renderer-only; model `full` mode is stored directly on the node through `displayMode`

### `jobs`
- one row per submitted provider run
- also acts as the durable queue source of truth

### `job_attempts`
- one row per execution attempt
- stores provider request/response payloads, timing, and failure details

### `assets`
- uploaded or generated media outputs
- `job_id = null` means imported/uploaded asset
- `job_id != null` means generated asset

### `job_preview_frames`
- durable intermediate preview images for running jobs
- keyed by job and output index

### `asset_feedback`
- per-asset rating and flagged state

### `asset_tags`
- per-project tag dictionary

### `asset_tag_links`
- join table between assets and tags

### `provider_models`
- renderer-facing provider/model capability metadata synced from the registry
- `capabilities` now also stores provider-access state used directly by the model picker and App Settings:
  - `billingAvailability`
  - `accessStatus`
  - `accessReason`
  - `accessMessage`
  - `lastCheckedAt`
- for Gemini, those fields describe Google-project access for the saved `GOOGLE_API_KEY`, not a user-selected tier flag

## Provider-Specific Node Settings
- model node settings still live inside `canvases.canvas_document`
- Gemini model nodes may now persist:
  - shared text settings: `textOutputTarget`, `maxOutputTokens`, `temperature`, `topP`, `topK`
  - Gemini 3 flash-family thinking: `thinkingLevel`
  - Gemini 2.5-family thinking: `thinkingBudget`
  - Gemini image settings: `temperature`, `aspectRatio`, `maxOutputTokens`, `topP`, `stopSequences`
  - Gemini image models that expose them may also persist `imageSize`
  - `gemini-3.1-flash-image-preview` may also persist `thinkingLevel` and `outputMode`
- unsupported Gemini keys are pruned when a node switches to a model that does not support them

## Removed Tables
- `canvas_nodes`
- `canvas_edges`

These were dropped because the current app persists the graph inside `canvases.canvas_document` and does not use relational node/edge rows.

## Queue Fields
The SQLite queue uses these `jobs` columns:
- `available_at`
- `claimed_at`
- `claim_token`
- `last_heartbeat_at`

Worker behavior:
- selects the next eligible queued row
- atomically transitions it to `running`
- heartbeats during execution
- retries by moving it back to `queued` with a future `available_at`
- marks it terminal on final success or failure

`jobs.node_run_payload` now includes:
- `runOrigin: "canvas-node" | "copilot"`
- `runOrigin = "canvas-node"` for normal visible node runs
- `runOrigin = "copilot"` for the session-only canvas copilot surface, which has no persisted source model node

## Filesystem References
- `assets.storage_ref`
  - relative path under the app-data assets root
- `job_preview_frames.storage_ref`
  - relative path under the app-data previews root

The renderer never sees absolute paths; those refs are resolved only in main/worker/storage code.

## Text Output Model
- OpenAI and Gemini text generations now serialize parsed generated-node descriptors in `job_attempts.provider_response`.
- Renderer-facing jobs expose:
  - `latestTextOutputs`
  - `generatedNodeDescriptors`
  - `generatedConnections`
  - optional `mixedOutputDiagnostics` for experimental Gemini image/text attempts
- Generated node descriptors can materialize:
  - `text-note`
  - `list`
  - `text-template`
- Each generated descriptor includes:
  - `descriptorId`
  - `runOrigin`
  - `sourceModelNodeId`, which may be `null` for copilot-origin runs
- `Smart Output` may produce multiple descriptors from one text response plus a `generatedConnections` array that references those descriptors by `descriptorId`.
- Parse failure falls back to one generated text-note descriptor instead of failing the job.
- Those outputs do not create `assets` rows.
- Queue debug data stores both the returned text and the parsed structured-output metadata inline in `job_attempts.provider_response`.
- Queue UI consumes those typed job-debug payloads only on the dedicated execution-record route; the queue list itself stays a compact run ledger.
- Experimental `Nano Banana 2` mixed image/text attempts may also store:
  - `mixedOutputDiagnostics.requested`
  - `mixedOutputDiagnostics.executionMode`
  - `mixedOutputDiagnostics.inputImageCount`
  - `mixedOutputDiagnostics.rawResponseTextPresent`
  - `mixedOutputDiagnostics.candidateTextPartCount`
  - `mixedOutputDiagnostics.imagePartCount`
  - `mixedOutputDiagnostics.warningCode`
  - `mixedOutputDiagnostics.warningMessage`
- Once a generated output is inserted onto the canvas, it becomes a normal user-owned node. Provenance remains for source/debug UI, but the polling loop no longer rewrites the node's content, layout, or connections.
- `generatedOutputReceiptKeys` prevent already-inserted outputs from being re-created on reload and prevent deleted generated nodes from coming back automatically.

## Provider Access Refresh
- provider registry sync remains the source of truth for `provider_models`
- startup sync now also refreshes provider access where supported
- saving, clearing, or manually refreshing `GOOGLE_API_KEY` rewrites Gemini access metadata in place
- worker-side Gemini failures may also update `provider_models.capabilities` so later picker/settings reads reflect the latest blocked or limited state

## Canvas Presentation Metadata
- `WorkflowNode.displayMode`
  - `preview`: default persisted surface
  - `compact`: persisted pill/tiny-node surface
  - `full`: persisted expanded model editor surface
  - `resized`: persisted custom width/height
- `WorkflowNode.size`
  - stored only when the node is in `resized`
  - used for model nodes, text notes, lists, templates, and asset nodes
- uploaded asset-source nodes also persist lightweight upload metadata in `WorkflowNode.settings`:
  - `source: "uploaded"`
  - `assetName`
  - `assetWidth`
  - `assetHeight`
- the renderer still accepts legacy `source: "upload"` nodes for backwards compatibility, but newly created uploaded asset nodes persist `source: "uploaded"`
- renderer sizing and caption logic uses uploaded-source metadata first so uploaded image nodes keep their real ratio and uploaded-source labeling without depending on fallback provider/model ids
- model-node `full` is intentionally not persisted; it is derived from active selection at render time
- renderer-only phantom previews are never written into `canvasDocument`

## Integrity Rules
- Project deletion cascades through workspace state, canvas, jobs, attempts, assets, feedback, tags, and preview metadata.
- Filesystem cleanup for project assets and job previews runs alongside row deletion.
- SQLite foreign keys stay enabled at connection startup.
