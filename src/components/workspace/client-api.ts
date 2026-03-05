import type {
  Asset,
  AssetFilterState,
  CanvasDocument,
  Job,
  JobDebugResponse,
  Project,
  ProviderModel,
  ProviderId,
  WorkflowNode,
} from "@/components/workspace/types";

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = typeof payload?.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function getProjects() {
  const res = await fetch("/api/projects", { cache: "no-store" });
  const data = await readJson<{ projects: Project[] }>(res);
  return data.projects || [];
}

export async function createProject(name: string) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const data = await readJson<{ project: Project }>(res);
  return data.project;
}

export async function openProject(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}/open`, { method: "POST" });
  await readJson<{ ok: boolean }>(res);
}

export async function updateProject(projectId: string, payload: { name?: string; status?: "active" | "archived" }) {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await readJson<{ project: Project }>(res);
  return data.project;
}

export async function removeProject(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
  await readJson<{ ok: boolean }>(res);
}

export async function getProviders() {
  const res = await fetch("/api/providers", { cache: "no-store" });
  const data = await readJson<{ providers: ProviderModel[] }>(res);
  return data.providers || [];
}

export async function getCanvasWorkspace(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}/canvas`, { cache: "no-store" });
  return readJson<{
    canvas: {
      canvasDocument: Record<string, unknown> | null;
    } | null;
    workspace: {
      assetViewerLayout?: "grid" | "compare_2" | "compare_4";
      filterState?: Record<string, unknown> | null;
    } | null;
  }>(res);
}

export async function putCanvasWorkspace(
  projectId: string,
  payload: {
    canvasDocument: CanvasDocument;
    assetViewerLayout?: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown>;
  }
) {
  const res = await fetch(`/api/projects/${projectId}/canvas`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await readJson<{ canvas: unknown }>(res);
}

export async function getJobs(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
  const data = await readJson<{ jobs: Job[] }>(res);
  return data.jobs || [];
}

export async function getJobDebug(projectId: string, jobId: string) {
  const res = await fetch(`/api/projects/${projectId}/jobs/${jobId}/debug`, {
    cache: "no-store",
  });

  return readJson<JobDebugResponse>(res);
}

export async function uploadProjectAsset(projectId: string, file: File) {
  const formData = new FormData();
  formData.set("file", file);

  const res = await fetch(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    body: formData,
  });

  const data = await readJson<{ asset: Asset }>(res);
  return data.asset;
}

export async function createJob(projectId: string, node: WorkflowNode) {
  const res = await fetch(`/api/projects/${projectId}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: node.providerId,
      modelId: node.modelId,
      nodePayload: {
        nodeId: node.id,
        nodeType: node.nodeType,
        prompt: node.prompt,
        settings: node.settings,
        outputType: node.outputType,
        upstreamNodeIds: node.upstreamNodeIds,
        upstreamAssetIds: node.upstreamAssetIds,
      },
    }),
  });

  await readJson<{ job: unknown }>(res);
}

export async function getAssets(projectId: string, filters: AssetFilterState) {
  const query = new URLSearchParams({
    type: filters.type,
    ratingAtLeast: String(filters.ratingAtLeast),
    flaggedOnly: String(filters.flaggedOnly),
    tag: filters.tag,
    providerId: filters.providerId,
    sort: filters.sort,
  });

  const res = await fetch(`/api/projects/${projectId}/assets?${query.toString()}`, {
    cache: "no-store",
  });

  const data = await readJson<{ assets: Asset[] }>(res);
  return data.assets || [];
}

export async function getAsset(assetId: string) {
  const res = await fetch(`/api/assets/${assetId}`, { cache: "no-store" });
  const data = await readJson<{ asset: Asset }>(res);
  return data.asset;
}

export async function updateAsset(assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await readJson<{ asset: Asset }>(res);
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

  return {
    id: String(raw.id || uid()),
    label: String(raw.label || `Node ${index + 1}`),
    providerId: (raw.providerId as ProviderId) || "google-gemini",
    modelId: String(raw.modelId || "gemini-3.1-flash"),
    nodeType: (raw.nodeType as WorkflowNode["nodeType"]) || "image-gen",
    outputType: (raw.outputType as WorkflowNode["outputType"]) || "image",
    prompt: String(raw.prompt || ""),
    settings: (raw.settings as Record<string, unknown>) || {},
    sourceAssetId: raw.sourceAssetId ? String(raw.sourceAssetId) : null,
    sourceAssetMimeType: raw.sourceAssetMimeType ? String(raw.sourceAssetMimeType) : null,
    upstreamNodeIds,
    upstreamAssetIds,
    x: typeof raw.x === "number" ? raw.x : 120 + (index % 4) * 260,
    y: typeof raw.y === "number" ? raw.y : 120 + Math.floor(index / 4) * 160,
  };
}
