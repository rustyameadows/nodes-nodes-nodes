import {
  defaultCanvasDocument,
  type CanvasDocument,
  type ProviderId,
  type WorkflowNode,
} from "@/components/workspace/types";
import { normalizeTextNoteSettings, getListNodeSettings, getTextTemplateNodeSettings } from "@/lib/list-template";
import { normalizeWorkflowNodeDisplayMode, normalizeWorkflowNodeSize } from "@/lib/canvas-node-presentation";
import { normalizeLegacyTopazModelId } from "@/lib/topaz-gigapixel-settings";

export function createCanvasLocalId() {
  return Math.random().toString(36).slice(2, 10);
}

export function normalizeCanvasNode(raw: Record<string, unknown>, index: number): WorkflowNode {
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
    id: String(raw.id || createCanvasLocalId()),
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

export function nextCanvasNodePosition(nodeCount: number, position?: { x: number; y: number }) {
  return {
    x: Math.round(position?.x ?? (120 + (nodeCount % 4) * 260)),
    y: Math.round(position?.y ?? (120 + Math.floor(nodeCount / 4) * 160)),
  };
}

export function normalizeCanvasDocument(raw: Record<string, unknown> | null | undefined): CanvasDocument {
  const source = (raw || {}) as Record<string, unknown>;
  const viewportRaw = (source.canvasViewport as Record<string, unknown> | undefined) || {};
  const savedGeneratedOutputReceiptKeys = Array.isArray(source.generatedOutputReceiptKeys)
    ? source.generatedOutputReceiptKeys
        .map((value) => (typeof value === "string" ? value : null))
        .filter((value): value is string => Boolean(value))
    : [];
  const nodesRaw = Array.isArray((source.workflow as Record<string, unknown> | undefined)?.nodes)
    ? (((source.workflow as Record<string, unknown>).nodes as unknown[]) || [])
    : [];

  return {
    canvasViewport: {
      x: typeof viewportRaw.x === "number" ? viewportRaw.x : defaultCanvasDocument.canvasViewport.x,
      y: typeof viewportRaw.y === "number" ? viewportRaw.y : defaultCanvasDocument.canvasViewport.y,
      zoom:
        typeof viewportRaw.zoom === "number"
          ? viewportRaw.zoom
          : defaultCanvasDocument.canvasViewport.zoom,
    },
    generatedOutputReceiptKeys: savedGeneratedOutputReceiptKeys,
    workflow: {
      nodes: nodesRaw
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((node, index) => normalizeCanvasNode(node, index)),
    },
  };
}
