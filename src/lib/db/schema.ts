import { relations, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProviderModelCapabilities } from "@/lib/types";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    lastOpenedAt: text("last_opened_at"),
  },
  (table) => ({
    statusUpdatedIdx: index("projects_status_updated_idx").on(table.status, table.updatedAt),
  })
);

export const projectWorkspaceStates = sqliteTable("project_workspace_states", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  isOpen: integer("is_open", { mode: "boolean" }).notNull().default(false),
  viewportState: text("viewport_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
  selectionState: text("selection_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
  assetViewerLayout: text("asset_viewer_layout", { enum: ["grid", "compare_2", "compare_4"] }).notNull().default("grid"),
  filterState: text("filter_state", { mode: "json" }).$type<Record<string, unknown> | null>(),
  updatedAt: timestamps.updatedAt,
});

export const canvases = sqliteTable("canvases", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  canvasDocument: text("canvas_document", { mode: "json" }).$type<Record<string, unknown> | null>(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamps.updatedAt,
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["queued", "running", "succeeded", "failed", "canceled"] }).notNull().default("queued"),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    nodeRunPayload: text("node_run_payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: text("queued_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    availableAt: text("available_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    claimedAt: text("claimed_at"),
    claimToken: text("claim_token"),
    lastHeartbeatAt: text("last_heartbeat_at"),
  },
  (table) => ({
    projectStateCreatedIdx: index("jobs_project_state_created_idx").on(table.projectId, table.state, table.createdAt),
    queueAvailabilityIdx: index("jobs_queue_availability_idx").on(table.state, table.availableAt),
  })
);

export const jobAttempts = sqliteTable(
  "job_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    providerRequest: text("provider_request", { mode: "json" }).$type<Record<string, unknown> | null>().notNull(),
    providerResponse: text("provider_response", { mode: "json" }).$type<Record<string, unknown> | null>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamps.createdAt,
  },
  (table) => ({
    jobAttemptUnique: index("job_attempts_job_attempt_idx").on(table.jobId, table.attemptNumber),
  })
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    type: text("type", { enum: ["image", "video", "text"] }).notNull(),
    storageRef: text("storage_ref").notNull(),
    mimeType: text("mime_type").notNull(),
    outputIndex: integer("output_index"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    checksum: text("checksum"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => ({
    projectCreatedIdx: index("assets_project_created_idx").on(table.projectId, table.createdAt),
  })
);

export const jobPreviewFrames = sqliteTable(
  "job_preview_frames",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    outputIndex: integer("output_index").notNull(),
    previewIndex: integer("preview_index").notNull(),
    storageRef: text("storage_ref").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamps.createdAt,
  },
  (table) => ({
    jobOutputCreatedIdx: index("job_preview_frames_job_output_created_idx").on(table.jobId, table.outputIndex, table.createdAt),
  })
);

export const assetFeedback = sqliteTable("asset_feedback", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  rating: integer("rating"),
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  updatedAt: timestamps.updatedAt,
});

export const assetTags = sqliteTable("asset_tags", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamps.createdAt,
});

export const assetTagLinks = sqliteTable(
  "asset_tag_links",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => assetTags.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.assetId, table.tagId] }),
  })
);


export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  featureFlags: text("feature_flags", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
});

export const providerModels = sqliteTable("provider_models", {
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  capabilities: text("capabilities", { mode: "json" }).$type<ProviderModelCapabilities>().notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
}, (table) => ({
  pk: primaryKey({ columns: [table.providerId, table.modelId] }),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  workspaceState: one(projectWorkspaceStates, {
    fields: [projects.id],
    references: [projectWorkspaceStates.projectId],
  }),
  canvas: one(canvases, {
    fields: [projects.id],
    references: [canvases.projectId],
  }),
  jobs: many(jobs),
  assets: many(assets),
  tags: many(assetTags),
}));
