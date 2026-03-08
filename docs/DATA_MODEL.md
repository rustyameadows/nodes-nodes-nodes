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

## Filesystem References
- `assets.storage_ref`
  - relative path under the app-data assets root
- `job_preview_frames.storage_ref`
  - relative path under the app-data previews root

The renderer never sees absolute paths; those refs are resolved only in main/worker/storage code.

## Text Output Model
- GPT text generations now serialize parsed generated-node descriptors in `job_attempts.provider_response`.
- Renderer-facing jobs expose:
  - `latestTextOutputs`
  - `generatedNodeDescriptors`
- Generated node descriptors can materialize:
  - `text-note`
  - `list`
  - `text-template`
- `Smart Output` may produce multiple descriptors from one text response, but they stay unconnected in this pass.
- Parse failure falls back to one generated text-note descriptor instead of failing the job.
- Those outputs do not create `assets` rows.
- Queue debug data stores both the returned text and the parsed structured-output metadata inline in `job_attempts.provider_response`.

## Integrity Rules
- Project deletion cascades through workspace state, canvas, jobs, attempts, assets, feedback, tags, and preview metadata.
- Filesystem cleanup for project assets and job previews runs alongside row deletion.
- SQLite foreign keys stay enabled at connection startup.
