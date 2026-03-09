import { isRunnableTopazGigapixelModel, normalizeLegacyTopazModelId } from "@/lib/topaz-gigapixel-settings";
import {
  getListNodeSettings,
  normalizeTextNoteSettings,
  getTextTemplateNodeSettings,
} from "@/lib/list-template";
import {
  normalizeWorkflowNodeDisplayMode,
  normalizeWorkflowNodeSize,
} from "@/lib/canvas-node-presentation";
import type { AppEventName, MenuCommand, MenuContext } from "@/lib/ipc-contract";
import {
  isRunnableTextModel,
  resolveImageModelSettings,
} from "@/lib/provider-model-helpers";
import type {
  AssetFilterState,
  CanvasDocument,
  Job,
  OpenAIImageMode,
  ProviderCredentialKey,
  ProviderCredentialStatus,
  ProviderId,
  RunnableWorkflowNodeType,
  WorkflowNode,
} from "@/components/workspace/types";

export async function getProjects() {
  return window.nodeInterface.listProjects();
}

export async function createProject(name: string) {
  return window.nodeInterface.createProject(name);
}

export async function openProject(projectId: string) {
  await window.nodeInterface.openProject(projectId);
}

export async function updateProject(projectId: string, payload: { name?: string; status?: "active" | "archived" }) {
  return window.nodeInterface.updateProject(projectId, payload);
}

export async function removeProject(projectId: string) {
  await window.nodeInterface.deleteProject(projectId);
}

export async function getProviders() {
  return window.nodeInterface.listProviders();
}

export async function getProviderCredentials(): Promise<ProviderCredentialStatus[]> {
  return window.nodeInterface.listProviderCredentials();
}

export async function saveProviderCredential(key: ProviderCredentialKey, value: string) {
  await window.nodeInterface.saveProviderCredential(key, value);
}

export async function clearProviderCredential(key: ProviderCredentialKey) {
  await window.nodeInterface.clearProviderCredential(key);
}

export async function refreshProviderAccess(providerId?: ProviderId) {
  await window.nodeInterface.refreshProviderAccess(providerId);
}

export async function setDesktopMenuContext(context: MenuContext) {
  await window.nodeInterface.setMenuContext(context);
}

export async function getCanvasWorkspace(projectId: string) {
  return window.nodeInterface.getWorkspaceSnapshot(projectId);
}

export async function putCanvasWorkspace(
  projectId: string,
  payload: {
    canvasDocument: CanvasDocument;
    assetViewerLayout?: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown>;
  }
) {
  await window.nodeInterface.saveWorkspaceSnapshot(projectId, payload);
}

export async function getJobs(projectId: string) {
  return window.nodeInterface.listJobs(projectId);
}

export async function getJobDebug(projectId: string, jobId: string) {
  return window.nodeInterface.getJobDebug(projectId, jobId);
}

export async function uploadProjectAsset(projectId: string, file: File) {
  const imported = await importProjectAssets(projectId, [file]);
  const asset = imported[0];
  if (!asset) {
    throw new Error("No asset was imported.");
  }
  return asset;
}

export async function createJob(projectId: string, node: WorkflowNode) {
  const executionMode: OpenAIImageMode = isRunnableTopazGigapixelModel(node.providerId, node.modelId)
    ? "edit"
    : isRunnableTextModel(node.providerId, node.modelId)
      ? "generate"
    : node.upstreamAssetIds.length > 0
      ? "edit"
      : "generate";
  const outputCount =
    resolveImageModelSettings(node.providerId, node.modelId, node.settings, executionMode)?.outputCount || 1;
  return createJobFromRequest(projectId, {
    providerId: node.providerId,
    modelId: node.modelId,
    nodePayload: {
      nodeId: node.id,
      nodeType: node.nodeType as RunnableWorkflowNodeType,
      prompt: node.prompt,
      settings: node.settings,
      outputType: node.outputType,
      executionMode,
      outputCount,
      promptSourceNodeId: node.promptSourceNodeId,
      upstreamNodeIds: node.upstreamNodeIds,
      upstreamAssetIds: node.upstreamAssetIds,
      inputImageAssetIds: [],
    },
  });
}

export async function createJobFromRequest(
  projectId: string,
  requestPayload: {
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
      promptSourceNodeId?: string | null;
      upstreamNodeIds: string[];
      upstreamAssetIds: string[];
      inputImageAssetIds: string[];
    };
  }
) {
  return window.nodeInterface.createJob(projectId, requestPayload);
}

export async function getAssets(
  projectId: string,
  filters: AssetFilterState,
  options?: {
    origin?: "all" | "uploaded" | "generated";
    query?: string;
  }
) {
  return window.nodeInterface.listAssets(projectId, filters, options);
}

export async function getAssetPointers(
  projectId: string,
  options: {
    origin: "uploaded" | "generated";
    query?: string;
  }
) {
  return getAssets(
    projectId,
    {
      type: "all",
      ratingAtLeast: 0,
      flaggedOnly: false,
      tag: "",
      providerId: "all",
      sort: "newest",
    },
    {
      origin: options.origin,
      query: options.query,
    }
  );
}

export async function getAsset(assetId: string) {
  return window.nodeInterface.getAsset(assetId);
}

export async function updateAsset(assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) {
  await window.nodeInterface.updateAsset(assetId, payload);
}

export async function importProjectAssets(projectId: string, files?: File[]) {
  if (!files || files.length === 0) {
    return window.nodeInterface.importAssets(projectId);
  }

  const items = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      content: await file.arrayBuffer(),
    }))
  );

  return window.nodeInterface.importAssets(projectId, items);
}

export function getAssetFileUrl(assetId: string) {
  return `app-asset://asset/${assetId}`;
}

export function getPreviewFrameFileUrl(previewFrameId: string, createdAt: string) {
  return `app-asset://preview/${previewFrameId}?ts=${encodeURIComponent(createdAt)}`;
}

export function subscribeToAppEvent(eventName: AppEventName, listener: (payload: { event: AppEventName; projectId?: string }) => void) {
  return window.nodeInterface.subscribe(eventName, listener);
}

export function subscribeToMenuCommand(listener: (command: MenuCommand) => void) {
  return window.nodeInterface.subscribeMenuCommand(listener);
}

export function summarizeQueue(jobs: Job[]) {
  return jobs.reduce(
    (acc, job) => {
      if (job.state === "queued") {
        acc.queued += 1;
      }
      if (job.state === "running") {
        acc.running += 1;
      }
      if (job.state === "failed") {
        acc.failed += 1;
      }
      return acc;
    },
    { queued: 0, running: 0, failed: 0 }
  );
}

export function mergeFilters(input: Record<string, unknown> | null | undefined, defaults: AssetFilterState) {
  return {
    ...defaults,
    ...(input || {}),
  } as AssetFilterState;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function normalizeNode(raw: Record<string, unknown>, index: number): WorkflowNode {
  const upstreamAssetIds = Array.isArray(raw.upstreamAssetIds)
    ? raw.upstreamAssetIds.map((item) => String(item))
    : [];
  const upstreamNodeIdsFromAssets = upstreamAssetIds
    .filter((item) => item.startsWith("node:"))
    .map((item) => item.slice("node:".length))
    .filter(Boolean);
  const upstreamNodeIds = Array.isArray(raw.upstreamNodeIds)
    ? raw.upstreamNodeIds.map((item) => String(item))
    : upstreamNodeIdsFromAssets;

  const inferredKind =
    raw.kind === "model" ||
    raw.kind === "asset-source" ||
    raw.kind === "text-note" ||
    raw.kind === "list" ||
    raw.kind === "text-template"
      ? (raw.kind as WorkflowNode["kind"])
      : raw.sourceAssetId
        ? "asset-source"
        : "model";
  const baseSettings =
    raw.settings && typeof raw.settings === "object"
      ? ({ ...(raw.settings as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  delete baseSettings.openaiImageMode;

  const normalizedSettings =
    inferredKind === "list"
      ? getListNodeSettings(baseSettings)
      : inferredKind === "text-template"
        ? getTextTemplateNodeSettings(baseSettings)
        : inferredKind === "text-note"
          ? normalizeTextNoteSettings(baseSettings)
          : baseSettings;

  return {
    id: String(raw.id || uid()),
    label: String(raw.label || `Node ${index + 1}`),
    providerId: (raw.providerId as ProviderId) || "openai",
    modelId: normalizeLegacyTopazModelId(String(raw.modelId || "gpt-image-1.5")) || "gpt-image-1.5",
    kind: inferredKind,
    nodeType:
      ((raw.nodeType as WorkflowNode["nodeType"]) ||
        (inferredKind === "text-note"
          ? "text-note"
          : inferredKind === "list"
            ? "list"
            : inferredKind === "text-template"
              ? "text-template"
              : "image-gen")),
    outputType:
      (raw.outputType as WorkflowNode["outputType"]) ||
      (inferredKind === "list" || inferredKind === "text-template" || inferredKind === "text-note" ? "text" : "image"),
    prompt: String(raw.prompt || ""),
    sourceAssetId: raw.sourceAssetId ? String(raw.sourceAssetId) : null,
    sourceAssetMimeType: raw.sourceAssetMimeType ? String(raw.sourceAssetMimeType) : null,
    sourceJobId: raw.sourceJobId
      ? String(raw.sourceJobId)
      : raw.settings &&
          typeof raw.settings === "object" &&
          (raw.settings as Record<string, unknown>).sourceJobId
        ? String((raw.settings as Record<string, unknown>).sourceJobId)
        : null,
    sourceOutputIndex:
      typeof raw.sourceOutputIndex === "number"
        ? raw.sourceOutputIndex
        : raw.settings &&
            typeof raw.settings === "object" &&
            typeof (raw.settings as Record<string, unknown>).outputIndex === "number"
          ? Number((raw.settings as Record<string, unknown>).outputIndex)
          : null,
    processingState:
      raw.processingState === "queued" || raw.processingState === "running" || raw.processingState === "failed"
        ? raw.processingState
        : null,
    promptSourceNodeId: raw.promptSourceNodeId ? String(raw.promptSourceNodeId) : null,
    upstreamNodeIds,
    upstreamAssetIds,
    settings: normalizedSettings,
    x: typeof raw.x === "number" ? raw.x : 120 + (index % 4) * 260,
    y: typeof raw.y === "number" ? raw.y : 120 + Math.floor(index / 4) * 160,
    displayMode: normalizeWorkflowNodeDisplayMode(raw.displayMode),
    size: normalizeWorkflowNodeSize(raw.size),
  };
}
