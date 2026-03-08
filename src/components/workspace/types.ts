import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { GeneratedNodeDescriptor } from "@/lib/generated-text-output";

export type ProviderId = "openai" | "google-gemini" | "topaz";
export type ProviderCredentialKey = "OPENAI_API_KEY" | "GOOGLE_API_KEY" | "TOPAZ_API_KEY";
export type ProviderCredentialSource = "keychain" | "environment" | "none";
export type ProviderExecutionMode = "generate" | "edit";
export type OpenAIImageMode = ProviderExecutionMode;
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageModeration = "auto" | "low";
export type ProviderRequirementKind = "env" | "executable";
export type ProviderPromptMode = "required" | "optional" | "unsupported";

export type ProviderRequirement = {
  kind: ProviderRequirementKind;
  key: string;
  configured: boolean;
  label: string;
};

export type WorkspaceView = "canvas" | "assets" | "queue" | "settings";
export type AppRouteView = WorkspaceView | "home" | "app-settings";

export type ProviderModelCapabilities = {
  text: boolean;
  image: boolean;
  video: boolean;
  runnable: boolean;
  availability: "ready" | "coming_soon";
  requiresApiKeyEnv: string | null;
  apiKeyConfigured: boolean;
  requirements: ProviderRequirement[];
  promptMode: ProviderPromptMode;
  executionModes: OpenAIImageMode[];
  acceptedInputMimeTypes: string[];
  maxInputImages: number;
  parameters: ModelParameterDefinition[];
  defaults: Record<string, unknown>;
};

export type ProviderModel = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ProviderModelCapabilities;
};

export type ProviderCredentialStatus = {
  key: ProviderCredentialKey;
  configured: boolean;
  source: ProviderCredentialSource;
};

export type WorkflowNodeKind = "model" | "asset-source" | "text-note" | "list" | "text-template";
export type WorkflowNodeType = "text-gen" | "image-gen" | "video-gen" | "transform" | "text-note" | "list" | "text-template";
export type RunnableWorkflowNodeType = "text-gen" | "image-gen" | "video-gen" | "transform";

export type ListColumn = {
  id: string;
  label: string;
};

export type ListRow = {
  id: string;
  values: Record<string, string>;
};

export type BaseListNodeSettings = {
  source: "list";
  columns: ListColumn[];
  rows: ListRow[];
};

export type GeneratedModelNodeProvenance = {
  sourceJobId: string;
  sourceModelNodeId: string;
  outputIndex: number;
  descriptorIndex: number;
};

export type GeneratedModelListSettings = GeneratedModelNodeProvenance & {
  source: "generated-model-list";
  columns: ListColumn[];
  rows: ListRow[];
};

export type BaseTextTemplateNodeSettings = {
  source: "text-template";
};

export type TextNoteSettings = {
  source: "text-note";
};

export type GeneratedTextNoteSettings = {
  source: "template-output";
  sourceTemplateNodeId: string;
  sourceListNodeId: string;
  batchId: string;
  rowId: string;
  rowIndex: number;
};

export type GeneratedModelTextNoteSettings = GeneratedModelNodeProvenance & {
  source: "generated-model-text";
};

export type GeneratedModelTextTemplateSettings = GeneratedModelNodeProvenance & {
  source: "generated-model-template";
};

export type ListNodeSettings = BaseListNodeSettings | GeneratedModelListSettings;
export type TextTemplateNodeSettings = BaseTextTemplateNodeSettings | GeneratedModelTextTemplateSettings;

export type WorkflowNodeSettings = Record<string, unknown>;

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
  kind: WorkflowNodeKind;
  nodeType: WorkflowNodeType;
  outputType: "text" | "image" | "video";
  prompt: string;
  settings: WorkflowNodeSettings;
  sourceAssetId: string | null;
  sourceAssetMimeType: string | null;
  sourceJobId: string | null;
  sourceOutputIndex: number | null;
  processingState: "queued" | "running" | "failed" | null;
  promptSourceNodeId: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  x: number;
  y: number;
};

export type WorkflowNodeSelectionState = {
  selectedNodeIds: string[];
  primarySelectedNodeId: string | null;
};

export type CanvasConnectionSelection = {
  id: string;
  kind: "input" | "prompt";
  sourceNodeId: string;
  targetNodeId: string;
  semanticType: "text" | "image" | "video" | "function" | "citrus" | "neutral";
  lineStyle: "solid" | "dashed";
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
    executionMode?: ProviderExecutionMode;
    outputCount?: number;
    promptSourceNodeId?: string | null;
    upstreamNodeIds?: string[];
    upstreamAssetIds?: string[];
    inputImageAssetIds?: string[];
  };
  assets?: Array<{
    id: string;
    type: Asset["type"];
    mimeType: string;
    outputIndex: number | null;
    createdAt: string;
  }>;
  latestPreviewFrames?: Array<{
    id: string;
    outputIndex: number;
    previewIndex: number;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: string;
  }>;
  latestTextOutputs?: Array<{
    outputIndex: number;
    content: string;
    responseId: string | null;
  }>;
  generatedNodeDescriptors?: GeneratedNodeDescriptor[];
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
  origin?: "generated" | "uploaded";
  type: "image" | "video" | "text";
  storageRef: string;
  mimeType: string;
  outputIndex?: number | null;
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
