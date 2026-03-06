# Data Model (V1)

## Principles
- Single local user in v1, but project isolation is strict.
- One canvas per project.
- Metadata in Postgres, binaries on filesystem.
- Provider/model IDs are stable and separate from UI labels.

## Core Entity Types

```ts
type ProjectStatus = "active" | "archived";
type JobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
type AssetType = "image" | "video" | "text";

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
};

type ProjectWorkspaceState = {
  projectId: string;
  isOpen: boolean;
  viewportState: Record<string, unknown>;
  selectionState: Record<string, unknown>;
  assetViewerLayout: "grid" | "compare-2" | "compare-4";
  filterState: Record<string, unknown>;
  updatedAt: Date;
};

type Canvas = {
  projectId: string;
  canvasDocument: Record<string, unknown>;
  version: number;
  updatedAt: Date;
};

type WorkflowNode = {
  id: string;
  kind: "model" | "asset-source" | "text-note" | "list" | "text-template";
  label: string;
  providerId: string;
  modelId: string;
  nodeType: "text-gen" | "image-gen" | "video-gen" | "transform" | "text-note" | "list" | "text-template";
  outputType: AssetType;
  prompt: string; // model prompt or text-note body
  settings: Record<string, unknown>;
  sourceAssetId: string | null;
  sourceAssetMimeType: string | null;
  sourceJobId: string | null;
  sourceOutputIndex: number | null;
  processingState: "queued" | "running" | "failed" | null;
  promptSourceNodeId: string | null; // model nodes only in v1
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  x: number;
  y: number;
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
  createdAt: Date;
  updatedAt: Date;
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
  rating: number | null; // 1..5
  flagged: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
};
```

### Canvas JSON Node Settings

```ts
type ListNodeSettings = {
  source: "list";
  columns: Array<{ id: string; label: string }>;
  rows: Array<{ id: string; values: Record<string, string> }>;
};

type TextTemplateNodeSettings = {
  source: "text-template";
};

type GeneratedTextNoteSettings = {
  source: "template-output";
  sourceTemplateNodeId: string;
  sourceListNodeId: string;
  batchId: string;
  rowId: string;
  rowIndex: number; // original source-row index
};
```

## Table Sketch

### `projects`
- `id` uuid pk
- `name` text not null
- `status` text check in (`active`, `archived`)
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- `last_opened_at` timestamptz null

### `project_workspace_states`
- `project_id` uuid pk references `projects(id)` on delete cascade
- `is_open` boolean not null default false
- `viewport_state` jsonb not null default '{}'
- `selection_state` jsonb not null default '{}'
- `asset_viewer_layout` text not null default 'grid'
- `filter_state` jsonb not null default '{}'
- `updated_at` timestamptz not null default now()

### `canvases`
- `project_id` uuid pk references `projects(id)` on delete cascade
- `canvas_document` jsonb not null default '{}'
- `version` integer not null default 1
- `updated_at` timestamptz not null default now()

### `canvas_nodes`
- `id` uuid pk
- `project_id` uuid not null references `projects(id)` on delete cascade
- `node_id` text not null
- `provider_id` text not null
- `model_id` text not null
- `node_type` text not null
- `settings` jsonb not null default '{}'
- `position` jsonb not null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- unique (`project_id`, `node_id`)

### `canvas_edges`
- `id` uuid pk
- `project_id` uuid not null references `projects(id)` on delete cascade
- `edge_id` text not null
- `source_node_id` text not null
- `target_node_id` text not null
- `source_port` text not null
- `target_port` text not null
- `created_at` timestamptz not null default now()
- unique (`project_id`, `edge_id`)

### `jobs`
- `id` uuid pk
- `project_id` uuid not null references `projects(id)` on delete cascade
- `state` text not null
- `provider_id` text not null
- `model_id` text not null
- `node_run_payload` jsonb not null
- `attempts` integer not null default 0
- `max_attempts` integer not null default 3
- `error_code` text null
- `error_message` text null
- `queued_at` timestamptz not null default now()
- `started_at` timestamptz null
- `finished_at` timestamptz null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

### `job_attempts`
- `id` uuid pk
- `job_id` uuid not null references `jobs(id)` on delete cascade
- `attempt_number` integer not null
- `provider_request` jsonb not null
- `provider_response` jsonb null
- `error_code` text null
- `error_message` text null
- `duration_ms` integer null
- `created_at` timestamptz not null default now()
- unique (`job_id`, `attempt_number`)

### `assets`
- `id` uuid pk
- `project_id` uuid not null references `projects(id)` on delete cascade
- `job_id` uuid null references `jobs(id)` on delete set null
- `type` text not null
- `storage_ref` text not null
- `mime_type` text not null
- `output_index` integer null
- `width` integer null
- `height` integer null
- `duration_ms` integer null
- `checksum` text null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

### `job_preview_frames`
- `id` uuid pk
- `job_id` uuid not null references `jobs(id)` on delete cascade
- `output_index` integer not null
- `preview_index` integer not null
- `storage_ref` text not null
- `mime_type` text not null
- `width` integer null
- `height` integer null
- `created_at` timestamptz not null default now()

### `asset_feedback`
- `asset_id` uuid pk references `assets(id)` on delete cascade
- `rating` integer null check (`rating` between 1 and 5)
- `flagged` boolean not null default false
- `updated_at` timestamptz not null default now()

### `asset_tags`
- `id` uuid pk
- `project_id` uuid not null references `projects(id)` on delete cascade
- `name` text not null
- `created_at` timestamptz not null default now()
- unique (`project_id`, `name`)

### `asset_tag_links`
- `asset_id` uuid not null references `assets(id)` on delete cascade
- `tag_id` uuid not null references `asset_tags(id)` on delete cascade
- `created_at` timestamptz not null default now()
- primary key (`asset_id`, `tag_id`)

### `provider_models`
- `provider_id` text not null
- `model_id` text not null
- `display_name` text not null
- `capabilities` jsonb not null default '{}'
- `active` boolean not null default true
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()
- primary key (`provider_id`, `model_id`)

## Indexing Guidance
- Index `jobs(project_id, state, created_at desc)`.
- Index `assets(project_id, created_at desc)`.
- Index `projects(status, updated_at desc)`.
- GIN indexes for `project_workspace_states.filter_state` and jsonb query-heavy columns if needed.

## Integrity Rules
- Assets must always reference a valid project.
- Generated multi-output assets must retain stable `output_index` ordering inside a job.
- Streamed preview frames are durable job data, not reviewable library assets.
- Asset origin is derived, not persisted as a separate enum:
  - `job_id is null` => uploaded
  - `job_id is not null` => generated
- Multiple canvas asset-source nodes may legally point at the same `asset.id`.
- Canvas nodes/edges cannot cross project boundaries.
- Text-note prompt-source links live inside canvas JSON and are project-scoped like other node relationships.
- List data and text-template metadata live inside canvas JSON only; no relational schema changes are required for this feature.
- Template-generated text notes are persisted as regular canvas text-note nodes with provenance stored in settings.
- Deleting a project cascades to canvas, jobs, assets, and tags.
- Archived projects remain readable but are excluded from default active list.

## Migration Notes (Future Multitenancy)
- Add `owner_type` and `owner_id` to `projects`.
- Add `users`, `orgs`, and share tables.
- Backfill existing local projects to a synthetic local user during migration.
