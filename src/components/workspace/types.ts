export type ProviderId = "openai" | "google-gemini" | "topaz";

export type WorkspaceView = "canvas" | "assets" | "queue" | "settings";

export type ProviderModel = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
};

export type Project = {
  id: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  workspaceState: {
    isOpen: boolean;
    assetViewerLayout: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown> | null;
  } | null;
  _count: {
    jobs: number;
    assets: number;
  };
};

export type ProjectNavItem = {
  id: string;
  name: string;
  status: "active" | "archived";
};

export type WorkflowNode = {
  id: string;
  label: string;
  providerId: ProviderId;
  modelId: string;
  nodeType: "text-gen" | "image-gen" | "video-gen" | "transform";
  outputType: "text" | "image" | "video";
  prompt: string;
  settings: Record<string, unknown>;
  sourceAssetId: string | null;
  sourceAssetMimeType: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  x: number;
  y: number;
};

export type WorkflowNodeSelectionState = {
  selectedNodeIds: string[];
  primarySelectedNodeId: string | null;
};

export type CanvasDocument = {
  canvasViewport: {
    x: number;
    y: number;
    zoom: number;
  };
  workflow: {
    nodes: WorkflowNode[];
  };
};

export type Job = {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  providerId: string;
  modelId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  nodeRunPayload?: {
    nodeId?: string;
    nodeType?: WorkflowNode["nodeType"];
    prompt?: string;
    settings?: Record<string, unknown>;
    outputType?: WorkflowNode["outputType"];
    upstreamNodeIds?: string[];
    upstreamAssetIds?: string[];
  };
  assets?: Array<{
    id: string;
    type: Asset["type"];
    createdAt: string;
  }>;
};

export type QueueSummary = {
  queued: number;
  running: number;
  failed: number;
};

export type Asset = {
  id: string;
  projectId?: string;
  jobId?: string | null;
  type: "image" | "video" | "text";
  storageRef: string;
  mimeType: string;
  checksum?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  createdAt: string;
  updatedAt?: string;
  tagNames: string[];
  rating: number | null;
  flagged: boolean;
  job: {
    providerId: string;
    modelId: string;
    state: string;
  } | null;
};

export type AssetFilterState = {
  type: "all" | "image" | "video" | "text";
  ratingAtLeast: number;
  flaggedOnly: boolean;
  tag: string;
  providerId: "all" | ProviderId;
  sort: "newest" | "oldest" | "rating";
};

export type MenuFlyoutState = {
  open: boolean;
  projectsOpen: boolean;
};

export type JobAttemptDebug = {
  id: string;
  attemptNumber: number;
  providerRequest: Record<string, unknown> | null;
  providerResponse: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type JobDebugResponse = {
  job: Job;
  attempts: JobAttemptDebug[];
};

export const defaultCanvasDocument: CanvasDocument = {
  canvasViewport: {
    x: 240,
    y: 180,
    zoom: 1,
  },
  workflow: {
    nodes: [],
  },
};

export const defaultFilterState: AssetFilterState = {
  type: "all",
  ratingAtLeast: 0,
  flaggedOnly: false,
  tag: "",
  providerId: "all",
  sort: "newest",
};
