import type {
  Asset,
  AssetFilterState,
  AppRouteView,
  CanvasDocument,
  ImportedAssetResult,
  Job,
  JobRunOrigin,
  JobDebugResponse,
  OpenAIImageMode,
  ProviderCredentialKey,
  ProviderCredentialStatus,
  Project,
  ProviderId,
  ProviderModel,
  RunnableWorkflowNodeType,
  WorkspaceView,
  WorkflowNode,
} from "@/components/workspace/types";

export type AppEventName = "projects.changed" | "workspace.changed" | "assets.changed" | "jobs.changed" | "providers.changed";

export type AppEventPayload = {
  event: AppEventName;
  projectId?: string;
  reason?: "asset-import";
};

export type CanvasMenuNodeType =
  | "model"
  | "text-note"
  | "list"
  | "text-template"
  | "asset-uploaded"
  | "asset-generated";

export type MenuCommand =
  | { type: "app.home" }
  | { type: "app.node-library" }
  | { type: "project.new" }
  | { type: "project.open"; projectId: string; view?: WorkspaceView }
  | { type: "app.settings" }
  | { type: "project.settings" }
  | { type: "view.open"; view: WorkspaceView }
  | { type: "assets.import" }
  | { type: "canvas.open-insert-menu" }
  | { type: "canvas.connect-selected" }
  | { type: "canvas.duplicate-selected" }
  | { type: "canvas.delete-selection" }
  | { type: "canvas.open-primary-editor" }
  | { type: "canvas.undo" }
  | { type: "canvas.redo" }
  | { type: "canvas.add-node"; nodeType: CanvasMenuNodeType; providerId?: ProviderId; modelId?: string };

export type MenuContext = {
  projectId: string | null;
  view: AppRouteView | null;
  hasProjects: boolean;
  selectedNodeCount: number;
  canConnectSelected: boolean;
  canDuplicateSelected: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export type MenuBarState = {
  mode: "default" | "drop";
  stagedDropFiles: Array<{
    name: string;
  }>;
};

export type ImportAssetsToProjectCanvasRequest = {
  items?: ImportAssetInput[];
  useStagedDropFiles?: boolean;
  redirectToCanvas?: boolean;
};

export type ImportAssetsToProjectCanvasResponse = {
  projectId: string;
  importedAssetIds: string[];
  insertedNodeIds: string[];
  redirectedToCanvas: boolean;
};

export type ShowAppTarget = {
  projectId?: string | null;
  view?: WorkspaceView | "home" | null;
};

export type WorkspaceSnapshotResponse = {
  canvas: {
    canvasDocument: Record<string, unknown> | null;
  } | null;
  workspace: {
    assetViewerLayout?: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown> | null;
  } | null;
};

export type CreateJobRequest = {
  providerId: ProviderId;
  modelId: string;
  nodePayload: {
    nodeId: string;
    nodeType: RunnableWorkflowNodeType;
    prompt: string;
    settings: Record<string, unknown>;
    outputType: WorkflowNode["outputType"];
    executionMode: OpenAIImageMode;
    outputCount: number;
    runOrigin?: JobRunOrigin;
    promptSourceNodeId?: string | null;
    upstreamNodeIds: string[];
    upstreamAssetIds: string[];
    inputImageAssetIds: string[];
  };
};

export type ImportAssetInput = {
  name: string;
  mimeType: string;
  content: ArrayBuffer;
};

export type NodeInterface = {
  listProjects: () => Promise<Project[]>;
  createProject: (name: string) => Promise<Project>;
  updateProject: (projectId: string, payload: { name?: string; status?: "active" | "archived" }) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  getWorkspaceSnapshot: (projectId: string) => Promise<WorkspaceSnapshotResponse>;
  saveWorkspaceSnapshot: (
    projectId: string,
    payload: {
      canvasDocument: CanvasDocument;
      assetViewerLayout?: "grid" | "compare_2" | "compare_4";
      filterState?: Record<string, unknown>;
    }
  ) => Promise<void>;
  listAssets: (
    projectId: string,
    filters: AssetFilterState,
    options?: {
      origin?: "all" | "uploaded" | "generated";
      query?: string;
    }
  ) => Promise<Asset[]>;
  getAsset: (assetId: string) => Promise<Asset>;
  updateAsset: (assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) => Promise<Asset>;
  importAssets: (projectId: string, items?: ImportAssetInput[]) => Promise<ImportedAssetResult[]>;
  importAssetsToProjectCanvas: (
    projectId: string,
    request?: ImportAssetsToProjectCanvasRequest
  ) => Promise<ImportAssetsToProjectCanvasResponse>;
  listJobs: (projectId: string) => Promise<Job[]>;
  createJob: (projectId: string, payload: CreateJobRequest) => Promise<Job>;
  getJobDebug: (projectId: string, jobId: string) => Promise<JobDebugResponse>;
  listProviders: () => Promise<ProviderModel[]>;
  listProviderCredentials: () => Promise<ProviderCredentialStatus[]>;
  saveProviderCredential: (key: ProviderCredentialKey, value: string) => Promise<void>;
  clearProviderCredential: (key: ProviderCredentialKey) => Promise<void>;
  refreshProviderAccess: (providerId?: ProviderId) => Promise<void>;
  showApp: (target?: ShowAppTarget) => Promise<void>;
  quitApp: () => Promise<void>;
  getMenuBarState: () => Promise<MenuBarState>;
  dismissMenuBarDropState: () => Promise<void>;
  setMenuContext: (context: MenuContext) => Promise<void>;
  subscribe: (event: AppEventName, listener: (payload: AppEventPayload) => void) => () => void;
  subscribeMenuCommand: (listener: (command: MenuCommand) => void) => () => void;
  subscribeMenuBarState: (listener: (state: MenuBarState) => void) => () => void;
};
