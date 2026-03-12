import { isRunnableTopazGigapixelModel } from "@/lib/topaz-gigapixel-settings";
import { normalizeCanvasNode } from "@/lib/canvas-document";
import type {
  AppEventName,
  AppEventPayload,
  ImportAssetsToProjectCanvasRequest,
  MenuBarState,
  MenuCommand,
  MenuContext,
  ShowAppTarget,
} from "@/lib/ipc-contract";
import {
  isRunnableTextModel,
  resolveImageModelSettings,
} from "@/lib/provider-model-helpers";
import type {
  AssetFilterState,
  CanvasDocument,
  ImportedAssetResult,
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
  const result = imported[0];
  const asset = result?.asset;
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
      runOrigin: "canvas-node",
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
      runOrigin?: import("@/components/workspace/types").JobRunOrigin;
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
      origin: "all",
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

export async function importProjectAssets(projectId: string, files?: File[]): Promise<ImportedAssetResult[]> {
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

export async function importAssetsToProjectCanvas(
  projectId: string,
  request?: ImportAssetsToProjectCanvasRequest & { files?: File[] }
) {
  const nextRequest: ImportAssetsToProjectCanvasRequest | undefined = request
    ? {
        ...request,
      }
    : undefined;

  if (request?.files && request.files.length > 0) {
    nextRequest!.items = await Promise.all(
      request.files.map(async (file) => ({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        content: await file.arrayBuffer(),
      }))
    );
  }

  return window.nodeInterface.importAssetsToProjectCanvas(projectId, nextRequest);
}

export async function showApp(target?: ShowAppTarget) {
  await window.nodeInterface.showApp(target);
}

export async function quitApp() {
  await window.nodeInterface.quitApp();
}

export async function getMenuBarState() {
  return window.nodeInterface.getMenuBarState();
}

export async function dismissMenuBarDropState() {
  await window.nodeInterface.dismissMenuBarDropState();
}

export async function saveCanvasPngExport(request: {
  suggestedName: string;
  data: ArrayBuffer;
  filePath?: string;
}) {
  return window.nodeInterface.saveCanvasPngExport(request);
}

export function getAssetFileUrl(assetId: string) {
  return `app-asset://asset/${assetId}`;
}

export function getPreviewFrameFileUrl(previewFrameId: string, createdAt: string) {
  return `app-asset://preview/${previewFrameId}?ts=${encodeURIComponent(createdAt)}`;
}

export function subscribeToAppEvent(eventName: AppEventName, listener: (payload: AppEventPayload) => void) {
  return window.nodeInterface.subscribe(eventName, listener);
}

export function subscribeToMenuCommand(listener: (command: MenuCommand) => void) {
  return window.nodeInterface.subscribeMenuCommand(listener);
}

export function subscribeToMenuBarState(listener: (state: MenuBarState) => void) {
  return window.nodeInterface.subscribeMenuBarState(listener);
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
  return normalizeCanvasNode(raw, index);
}
