"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useRouter } from "@/renderer/navigation";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import {
  CanvasNodeContent,
  type ActiveCanvasNodeEditorState,
  type CanvasModelEditorState,
} from "@/components/canvas-nodes";
import { CanvasCopilotWidget } from "@/components/workspace/views/canvas-copilot-widget";
import type {
  CanvasConnection,
  CanvasInsertRequest,
  CanvasNodeGeneratedProvenance,
  CanvasPhantomPreview,
  CanvasRenderNode,
  CanvasSelectionAction,
} from "@/components/canvas-node-types";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { isModelParameterVisible } from "@/lib/model-parameters";
import {
  createGeneratedModelNode,
  getGeneratedDescriptorDefaultLabel,
  type GeneratedConnectionDescriptor,
  type GeneratedNodeDescriptor,
  type GeneratedNodeKind,
  shouldConnectGeneratedDescriptorToSourceModel,
} from "@/lib/generated-text-output";
import {
  hydrateGeneratedImageNode,
  needsGeneratedImageNodeHydration,
  shouldSkipConsumedGeneratedImageReceipt,
} from "@/lib/generated-image-hydration";
import {
  buildGeneratedImageOutputPosition,
  getGeneratedModelSpawnAnchor,
  resolveGeneratedOutputVisualIndex,
  resolveGeneratedTextNodePlacement,
} from "@/lib/generated-output-positioning";
import {
  applyCanvasCopilotSuccessSummaries,
  buildCanvasCopilotRunPreview,
  getCanvasCopilotModelVariants,
  getDefaultCanvasCopilotModelVariant,
  type CanvasCopilotHydrationSummary,
  type CanvasCopilotMessage,
} from "@/lib/canvas-copilot";
import {
  formatProviderAccessMessage,
  formatProviderRequirementMessage,
  getFirstUnconfiguredRequirement,
  isProviderAccessBlocked,
} from "@/lib/provider-readiness";
import {
  isRunnableTopazGigapixelModel,
  resolveTopazGigapixelSettings,
} from "@/lib/topaz-gigapixel-settings";
import {
  createJobFromRequest,
  getAssetFileUrl,
  getCanvasWorkspace,
  getAssetPointers,
  getJobs,
  getPreviewFrameFileUrl,
  getProviders,
  importProjectAssets,
  normalizeNode,
  openProject,
  putCanvasWorkspace,
  subscribeToAppEvent,
  uid,
  uploadProjectAsset,
} from "@/components/workspace/client-api";
import {
  defaultCanvasDocument,
  type Asset,
  type CanvasDocument,
  type Job,
  type ListNodeSettings,
  type ProviderModel,
  type RunnableWorkflowNodeType,
  type WorkflowNode,
  type WorkflowNodeSize,
} from "@/components/workspace/types";
import {
  buildTextTemplatePreview,
  createDefaultListNodeSettings,
  createGeneratedTextNoteSettings,
  createTextNoteSettings,
  createTextTemplateNodeSettings,
  getGeneratedModelNodeSource,
  getGeneratedTextNoteSettings,
  getListNodeSettings,
  getTextTemplateNodeSettings,
  isGeneratedTextNoteNode,
} from "@/lib/list-template";
import { getOpenAiTextOutputTargetLabel, readOpenAiTextOutputTarget } from "@/lib/text-output-targets";
import {
  buildAssetRefsFromNodes,
  createUploadedAssetSourceNode,
  getAssetPointerNodeLabel,
  getUploadedAssetNodeAspectRatio,
  insertImportedAssetsIntoCanvasDocument,
  outputTypeFromAssetType,
} from "@/lib/canvas-asset-nodes";
import { centerCanvasInsertPosition } from "@/lib/canvas-layout";
import { nextCanvasNodeZIndex } from "@/lib/canvas-document";
import {
  buildProviderDebugRequest,
  getFallbackProviderModel,
  isRunnableTextModel,
  resolveImageModelSettings,
  resolveProviderModelSettings,
  resolveTextModelSettings,
} from "@/lib/provider-model-helpers";
import { canConnectCanvasNodes } from "@/lib/canvas-connection-rules";
import {
  getDefaultModelCatalogVariant,
  getInsertableNodeCatalogEntries,
  getModelCatalogVariantById,
  getModelCatalogVariants,
  groupModelCatalogVariants,
  type NodeCatalogVariant,
} from "@/lib/node-catalog";
import {
  applyCanvasHistoryPatch,
  createCanvasHistoryPatch,
  type CanvasHistoryPatch,
  type CanvasHistoryState,
} from "@/lib/canvas-history";
import {
  resolveCanvasNodePresentation,
} from "@/lib/canvas-node-presentation";
import {
  getCanvasGeneratedOutputReceiptKeys,
  getGeneratedOutputReceiptKey,
  getGeneratedOutputReceiptKeyForNode,
  getLegacyGeneratedOutputReceiptKeys,
  setCanvasGeneratedOutputReceiptKeys,
} from "@/lib/generated-output-receipts";
import { subscribeToCanvasMenuCommand } from "@/renderer/canvas-menu-command-bus";
import { publishCanvasMenuState, resetCanvasMenuState } from "@/renderer/canvas-menu-context-bus";
import styles from "./canvas-view.module.css";

const supportedOutputOrder = ["image", "video", "text"] as const;
const generatedTextNodeOffsetX = 320;
const generatedTextNodeOffsetY = 172;
const copilotGeneratedNodeOffsetX = 252;
const copilotGeneratedNodeOffsetY = 152;
const copilotGeneratedNodeColumnOffsetX = 48;
const CANVAS_HISTORY_LIMIT = 100;
const COALESCED_HISTORY_DELAY_MS = 450;
const NODE_FOCUS_ZOOM_PADDING_X = 96;
const NODE_FOCUS_ZOOM_PADDING_Y = 84;
const NODE_FOCUS_MIN_ZOOM = 0.42;
const NODE_FOCUS_MAX_ZOOM = 1.08;
const NODE_FOCUS_ANIMATION_DURATION_MS = 165;
const NODE_FOCUS_SETTLE_MAX_FRAMES = 18;
const NODE_FOCUS_SETTLE_STABLE_FRAMES = 2;
const INSERT_MENU_NODE_PREVIEW_SIZE = {
  width: 212,
  height: 72,
} as const;

type Props = {
  projectId: string;
};

type CanvasInsertMenuState = {
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
  mode: "canvas" | "model-input" | "template-input";
  connectToNodeId?: string;
};

type AssetPickerState = {
  origin: "generated" | "uploaded";
  worldX: number;
  worldY: number;
  connectToModelNodeId?: string;
};

type PreviewFrameSummary = NonNullable<Job["latestPreviewFrames"]>[number];
type CanvasSemanticType = WorkflowNode["outputType"] | "operator" | "citrus";
const canvasSemanticTypeOrder: CanvasSemanticType[] = ["text", "image", "video", "operator", "citrus"];
type PendingCenteredInsert = {
  nodeId: string;
  anchor: { x: number; y: number };
};

type CanvasHistoryStacks = {
  undo: CanvasHistoryPatch<CanvasConnection>[];
  redo: CanvasHistoryPatch<CanvasConnection>[];
};

type PendingCoalescedCanvasHistory = {
  key: string;
  beforeState: CanvasHistoryState<CanvasConnection>;
  afterState: CanvasHistoryState<CanvasConnection>;
};

type GeneratedTextPlaceholderTarget = "note" | "list" | "template" | "smart";

function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null)
  );
}

function getNodeSemanticOutputType(node: WorkflowNode): CanvasSemanticType {
  if (node.kind === "text-template") {
    return "operator";
  }
  if (
    node.kind === "model" &&
    (node.outputType === "text" || node.outputType === "image" || node.outputType === "video")
  ) {
    return "citrus";
  }
  return node.outputType;
}

function capabilityEnabled(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function getCenteredInsertPosition(position: { x: number; y: number }) {
  return centerCanvasInsertPosition(position, INSERT_MENU_NODE_PREVIEW_SIZE);
}

function insertMenuVariantStatusClassName(status: NodeCatalogVariant["status"]) {
  if (status === "ready") {
    return styles.insertMenuStatusReady;
  }
  if (status === "coming_soon") {
    return styles.insertMenuStatusSoon;
  }
  if (status === "missing_key") {
    return styles.insertMenuStatusMissing;
  }
  if (status === "temporarily_limited") {
    return styles.insertMenuStatusWarn;
  }
  if (status === "unverified") {
    return styles.insertMenuStatusMuted;
  }
  return styles.insertMenuStatusMuted;
}

function getModelDefaultSettings(model: ProviderModel | undefined) {
  return model?.capabilities?.defaults ? { ...model.capabilities.defaults } : {};
}

function resolveModelSettings(
  model: ProviderModel | undefined,
  settings: Record<string, unknown>,
  executionMode: "generate" | "edit"
) {
  const mergedSettings = {
    ...getModelDefaultSettings(model),
    ...settings,
  };
  return resolveProviderModelSettings(model?.providerId, model?.modelId, mergedSettings, executionMode);
}

function getModelSupportedOutputs(model: ProviderModel | undefined): WorkflowNode["outputType"][] {
  const capabilities = model?.capabilities;
  const outputs = supportedOutputOrder.filter((outputType) => capabilityEnabled(capabilities?.[outputType]));
  return outputs.length > 0 ? [...outputs] : ["image", "video", "text"];
}

function resolveOutputType(
  currentOutputType: WorkflowNode["outputType"] | undefined,
  supportedOutputs: WorkflowNode["outputType"][]
): WorkflowNode["outputType"] {
  if (currentOutputType && supportedOutputs.includes(currentOutputType)) {
    return currentOutputType;
  }
  return supportedOutputs[0];
}

function nodeTypeFromOutput(outputType: WorkflowNode["outputType"]): WorkflowNode["nodeType"] {
  if (outputType === "text") {
    return "text-gen";
  }
  if (outputType === "video") {
    return "video-gen";
  }
  return "image-gen";
}

function nextCanvasNodePosition(nodeCount: number, position?: { x: number; y: number }) {
  return {
    x: Math.round(position?.x ?? (120 + (nodeCount % 4) * 260)),
    y: Math.round(position?.y ?? (120 + Math.floor(nodeCount / 4) * 160)),
  };
}

function promoteCanvasNodesToFront(nodes: WorkflowNode[], nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return null;
  }

  const uniqueNodeIds = [...new Set(nodeIds)].filter((nodeId) => nodes.some((node) => node.id === nodeId));
  if (uniqueNodeIds.length === 0) {
    return null;
  }

  let nextZIndex = nextCanvasNodeZIndex(nodes);
  let didChange = false;
  const nextNodes = nodes.map((node) => {
    if (!uniqueNodeIds.includes(node.id)) {
      return node;
    }

    didChange = true;
    return {
      ...node,
      zIndex: nextZIndex++,
    };
  });

  return didChange ? nextNodes : null;
}

function applyCanvasNodeConnection(
  nodes: WorkflowNode[],
  sourceNodeId: string,
  targetNodeId: string,
  expectedKind?: GeneratedConnectionDescriptor["kind"]
) {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId) || null;
  const targetNode = nodes.find((node) => node.id === targetNodeId) || null;
  if (!sourceNode || !targetNode || !canConnectCanvasNodes(sourceNode, targetNode)) {
    return {
      nodes,
      applied: false,
    };
  }

  const inferredKind: GeneratedConnectionDescriptor["kind"] = sourceNode.kind === "text-note" ? "prompt" : "input";
  if (expectedKind && expectedKind !== inferredKind) {
    return {
      nodes,
      applied: false,
    };
  }

  if (targetNode.kind === "text-note") {
    if (
      targetNode.upstreamNodeIds.length === 1 &&
      targetNode.upstreamNodeIds[0] === sourceNodeId &&
      targetNode.upstreamAssetIds.length === 1 &&
      targetNode.upstreamAssetIds[0] === `node:${sourceNodeId}`
    ) {
      return {
        nodes,
        applied: false,
      };
    }

    return {
      nodes: nodes.map((node) =>
        node.id === targetNodeId
          ? {
              ...node,
              upstreamNodeIds: [sourceNodeId],
              upstreamAssetIds: [`node:${sourceNodeId}`],
            }
          : node
      ),
      applied: true,
    };
  }

  if (sourceNode.kind === "text-note") {
    if (targetNode.promptSourceNodeId === sourceNodeId) {
      return {
        nodes,
        applied: false,
      };
    }

    return {
      nodes: nodes.map((node) =>
        node.id === targetNodeId
          ? {
              ...node,
              promptSourceNodeId: sourceNodeId,
            }
          : node
      ),
      applied: true,
    };
  }

  if (sourceNode.kind === "list") {
    const upstreamAssetIds = buildAssetRefsFromNodes([sourceNodeId], nodes);
    if (
      targetNode.upstreamNodeIds.length === 1 &&
      targetNode.upstreamNodeIds[0] === sourceNodeId &&
      JSON.stringify(targetNode.upstreamAssetIds) === JSON.stringify(upstreamAssetIds)
    ) {
      return {
        nodes,
        applied: false,
      };
    }

    return {
      nodes: nodes.map((node) =>
        node.id === targetNodeId
          ? {
              ...node,
              upstreamNodeIds: [sourceNodeId],
              upstreamAssetIds,
            }
          : node
      ),
      applied: true,
    };
  }

  const upstreamNodeIds = [...new Set([...targetNode.upstreamNodeIds, sourceNodeId])];
  const upstreamAssetIds = buildAssetRefsFromNodes(upstreamNodeIds, nodes);
  if (
    JSON.stringify(targetNode.upstreamNodeIds) === JSON.stringify(upstreamNodeIds) &&
    JSON.stringify(targetNode.upstreamAssetIds) === JSON.stringify(upstreamAssetIds)
  ) {
    return {
      nodes,
      applied: false,
    };
  }

  return {
    nodes: nodes.map((node) =>
      node.id === targetNodeId
        ? {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds,
          }
        : node
    ),
    applied: true,
  };
}

function buildCopilotGeneratedNodePosition(anchor: { x: number; y: number }, visualIndex: number) {
  return {
    x: Math.round(anchor.x + Math.floor(visualIndex / 3) * copilotGeneratedNodeOffsetX + Math.floor(visualIndex / 6) * copilotGeneratedNodeColumnOffsetX),
    y: Math.round(anchor.y + (visualIndex % 3) * copilotGeneratedNodeOffsetY),
  };
}

function getPreviewFrameUrl(projectId: string, jobId: string, previewFrame: PreviewFrameSummary) {
  return getPreviewFrameFileUrl(previewFrame.id, previewFrame.createdAt);
}

function getNodeSourceJobId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  if (node.sourceJobId) {
    return node.sourceJobId;
  }
  return typeof node.settings.sourceJobId === "string" ? node.settings.sourceJobId : null;
}

function getNodeSourceOutputIndex(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  if (typeof node.sourceOutputIndex === "number") {
    return node.sourceOutputIndex;
  }
  return typeof node.settings.outputIndex === "number" ? Number(node.settings.outputIndex) : null;
}

function getSourceModelNodeId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  return typeof node.settings.sourceModelNodeId === "string" ? node.settings.sourceModelNodeId : null;
}

function getGeneratedNodeProvenance(node: WorkflowNode | null | undefined): CanvasNodeGeneratedProvenance | null {
  if (!node) {
    return null;
  }

  if (node.kind === "asset-source" && isGeneratedAssetNode(node)) {
    return "model";
  }

  if (node.kind === "text-note" && getGeneratedTextNoteSettings(node.settings)) {
    return "operator";
  }

  return getGeneratedModelNodeSource(node.settings) ? "model" : null;
}

function getTextOutputTargetFromSettings(settings: Record<string, unknown> | undefined) {
  return readOpenAiTextOutputTarget(settings?.textOutputTarget);
}

function isGeneratedAssetNode(node: WorkflowNode | null | undefined) {
  if (!node || node.kind !== "asset-source") {
    return false;
  }
  return node.settings.source === "generated" || Boolean(getNodeSourceJobId(node));
}

function isListNode(node: WorkflowNode | null | undefined) {
  return node?.kind === "list";
}

function isTextTemplateNode(node: WorkflowNode | null | undefined) {
  return node?.kind === "text-template";
}

function getGeneratedNodeLabel(existingCount: number) {
  return `Output ${existingCount + 1}`;
}

function isCanvasPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y);
}

function resolveCanvasPointFallback(modelNode: Pick<WorkflowNode, "x" | "y">, point: unknown) {
  if (isCanvasPoint(point)) {
    return {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
  }

  return {
    x: Math.round(modelNode.x),
    y: Math.round(modelNode.y),
  };
}

function sortSemanticTypes(values: CanvasSemanticType[]) {
  const unique = [...new Set(values)];
  return canvasSemanticTypeOrder.filter((type) => unique.includes(type));
}

function getExpectedGeneratedOutputCount(job: Job) {
  const requestedCount =
    typeof job.nodeRunPayload?.outputCount === "number"
      ? Math.min(4, Math.max(1, job.nodeRunPayload.outputCount))
      : null;
  const imageAssetCount = (job.assets || []).filter((asset) => asset.type === "image").length;

  if (requestedCount !== null) {
    return Math.max(requestedCount, imageAssetCount);
  }

  if (imageAssetCount > 0) {
    return imageAssetCount;
  }

  return job.nodeRunPayload?.outputType === "image" ? 1 : 0;
}

function createGeneratedOutputNode(
  modelNode: WorkflowNode,
  job: Job,
  sourceNodeId: string,
  zIndex: number,
  outputIndex: number,
  visualIndexOrPosition?: number | { x: number; y: number } | null,
  positionMaybe?: { x: number; y: number } | null
): WorkflowNode {
  const safeVisualIndex = resolveGeneratedOutputVisualIndex(
    typeof visualIndexOrPosition === "number" ? visualIndexOrPosition : undefined,
    outputIndex
  );
  const safePosition = resolveCanvasPointFallback(
    modelNode,
    isCanvasPoint(visualIndexOrPosition) && !positionMaybe ? visualIndexOrPosition : positionMaybe
  );

  return {
    id: uid(),
    label: getGeneratedNodeLabel(safeVisualIndex),
    kind: "asset-source",
    providerId: modelNode.providerId,
    modelId: modelNode.modelId,
    nodeType: "transform",
    outputType: "image",
    prompt: "",
    settings: {
      source: "generated",
      sourceJobId: job.id,
      sourceModelNodeId: sourceNodeId,
      outputIndex,
    },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: job.id,
    sourceOutputIndex: outputIndex,
    processingState: job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null,
    promptSourceNodeId: null,
    upstreamNodeIds: [sourceNodeId],
    upstreamAssetIds: [`node:${sourceNodeId}`],
    x: safePosition.x,
    y: safePosition.y,
    zIndex,
    displayMode: "preview",
    size: null,
  };
}

function getGeneratedTextOutputCount(nodes: WorkflowNode[], templateNodeId: string) {
  return nodes.filter((node) => {
    const generatedSettings = getGeneratedTextNoteSettings(node.settings);
    return generatedSettings?.sourceTemplateNodeId === templateNodeId;
  }).length;
}

function getGeneratedModelNodeCount(nodes: WorkflowNode[], sourceModelNodeId: string) {
  return nodes.filter((node) => {
    const generatedSettings = getGeneratedModelNodeSource(node.settings);
    return generatedSettings?.sourceModelNodeId === sourceModelNodeId;
  }).length;
}

function createGeneratedTextOutputNode(
  templateNode: WorkflowNode,
  listNodeId: string,
  batchId: string,
  row: ReturnType<typeof buildTextTemplatePreview>["rows"][number],
  zIndex: number,
  visualIndex: number,
  generatedIndex: number
): WorkflowNode {
  return {
    id: uid(),
    label: `Row ${generatedIndex + 1}`,
    kind: "text-note",
    providerId: templateNode.providerId,
    modelId: templateNode.modelId,
    nodeType: "text-note",
    outputType: "text",
    prompt: row.text,
    settings: createGeneratedTextNoteSettings({
      sourceTemplateNodeId: templateNode.id,
      sourceListNodeId: listNodeId,
      batchId,
      rowId: row.rowId,
      rowIndex: row.rowIndex,
    }),
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [templateNode.id],
    upstreamAssetIds: [`node:${templateNode.id}`],
    x: Math.round(templateNode.x + generatedTextNodeOffsetX),
    y: Math.round(templateNode.y + visualIndex * generatedTextNodeOffsetY),
    zIndex,
    displayMode: "preview",
    size: null,
  };
}

function createGeneratedModelPlaceholderNode(
  modelNode: WorkflowNode,
  job: Job,
  sourceNodeId: string,
  target: GeneratedTextPlaceholderTarget,
  zIndex: number,
  visualIndexOrPosition: number | { x: number; y: number } | null | undefined,
  positionMaybe?: { x: number; y: number } | null
): WorkflowNode {
  const safeVisualIndex =
    typeof visualIndexOrPosition === "number" && Number.isFinite(visualIndexOrPosition)
      ? Math.max(0, Math.trunc(visualIndexOrPosition))
      : 0;
  const safePosition = resolveCanvasPointFallback(
    modelNode,
    isCanvasPoint(visualIndexOrPosition) && !positionMaybe ? visualIndexOrPosition : positionMaybe
  );
  const descriptorKind: GeneratedNodeKind =
    target === "list" ? "list" : target === "template" ? "text-template" : "text-note";
  const descriptor: GeneratedNodeDescriptor =
    descriptorKind === "list"
      ? {
          descriptorId: "generated-0-0",
          kind: "list",
          label: getGeneratedDescriptorDefaultLabel("list", safeVisualIndex),
          columns: [],
          rows: [],
          sourceJobId: job.id,
          sourceModelNodeId: sourceNodeId,
          outputIndex: 0,
          descriptorIndex: 0,
          runOrigin: "canvas-node",
        }
      : descriptorKind === "text-template"
        ? {
            descriptorId: "generated-0-0",
            kind: "text-template",
            label: getGeneratedDescriptorDefaultLabel("text-template", safeVisualIndex),
            templateText: "",
            sourceJobId: job.id,
            sourceModelNodeId: sourceNodeId,
            outputIndex: 0,
            descriptorIndex: 0,
            runOrigin: "canvas-node",
          }
      : {
            descriptorId: "generated-0-0",
            kind: "text-note",
            label:
              target === "smart"
                ? "Structured outputs"
                : getGeneratedDescriptorDefaultLabel("text-note", safeVisualIndex),
            text: "",
            sourceJobId: job.id,
            sourceModelNodeId: sourceNodeId,
            outputIndex: 0,
            descriptorIndex: 0,
            runOrigin: "canvas-node",
          };

  return createGeneratedModelNode({
    id: uid(),
    providerId: modelNode.providerId,
    modelId: modelNode.modelId,
    modelNodeId: sourceNodeId,
    label: descriptor.label,
    position: safePosition,
    zIndex,
    processingState: job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null,
    descriptor,
  });
}

function findMatchingGeneratedImageAsset(job: Job, sourceOutputIndex: number | null) {
  const imageAssets = [...(job.assets || [])]
    .filter((asset) => asset.type === "image")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  if (imageAssets.length === 0) {
    return null;
  }

  if (sourceOutputIndex === null) {
    return imageAssets.at(-1) || null;
  }

  const exactMatch = imageAssets.find((asset) => asset.outputIndex === sourceOutputIndex);
  if (exactMatch) {
    return exactMatch;
  }

  if (sourceOutputIndex === 0) {
    const legacyMatch = imageAssets.find((asset) => asset.outputIndex === null);
    if (legacyMatch) {
      return legacyMatch;
    }
  }

  return null;
}

function isConsumedGeneratedOutputNode(node: WorkflowNode, receiptKeys: Set<string>) {
  const receiptKey = getGeneratedOutputReceiptKeyForNode(node);
  return Boolean(receiptKey && receiptKeys.has(receiptKey));
}

export function CanvasView({ projectId }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [insertMenu, setInsertMenu] = useState<CanvasInsertMenuState | null>(null);
  const [insertMenuExpandedEntryId, setInsertMenuExpandedEntryId] = useState<string | null>(null);
  const [assetPicker, setAssetPicker] = useState<AssetPickerState | null>(null);
  const [assetPickerQuery, setAssetPickerQuery] = useState("");
  const [assetPickerAssets, setAssetPickerAssets] = useState<Asset[]>([]);
  const [assetPickerSelectedIds, setAssetPickerSelectedIds] = useState<string[]>([]);
  const [assetPickerLoading, setAssetPickerLoading] = useState(false);
  const [assetPickerError, setAssetPickerError] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<CanvasConnection | null>(null);
  const [activeFullNodeId, setActiveFullNodeId] = useState<string | null>(null);
  const [pinnedModelFullNodeId, setPinnedModelFullNodeId] = useState<string | null>(null);
  const [pendingViewportFocusNodeId, setPendingViewportFocusNodeId] = useState<string | null>(null);
  const [pendingCenteredInsert, setPendingCenteredInsert] = useState<PendingCenteredInsert | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotDraft, setCopilotDraft] = useState("");
  const [copilotMessages, setCopilotMessages] = useState<CanvasCopilotMessage[]>([]);
  const [copilotModelVariantId, setCopilotModelVariantId] = useState<string | null>(null);
  const [copilotActiveJobId, setCopilotActiveJobId] = useState<string | null>(null);
  const [historyStacks, setHistoryStacks] = useState<CanvasHistoryStacks>({
    undo: [],
    redo: [],
  });

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedCanvasRef = useRef(false);
  const pendingCanvasSaveRef = useRef<CanvasDocument | null>(null);
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const assetPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingUploadAnchorRef = useRef<{ x: number; y: number; connectToModelNodeId?: string } | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const nativeMenuInsertCountRef = useRef(0);
  const canvasDocRef = useRef(canvasDoc);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const selectedConnectionRef = useRef(selectedConnection);
  const activeFullNodeIdRef = useRef(activeFullNodeId);
  const pinnedModelFullNodeIdRef = useRef(pinnedModelFullNodeId);
  const viewportFocusAnimationFrameRef = useRef<number | null>(null);
  const viewportFocusSetupFrameIdsRef = useRef<number[]>([]);
  const historyStacksRef = useRef(historyStacks);
  const pendingCoalescedHistoryRef = useRef<PendingCoalescedCanvasHistory | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    canvasDocRef.current = canvasDoc;
  }, [canvasDoc]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    selectedConnectionRef.current = selectedConnection;
  }, [selectedConnection]);

  useEffect(() => {
    activeFullNodeIdRef.current = activeFullNodeId;
  }, [activeFullNodeId]);

  useEffect(() => {
    pinnedModelFullNodeIdRef.current = pinnedModelFullNodeId;
  }, [pinnedModelFullNodeId]);

  useEffect(() => {
    if (!insertMenu) {
      setInsertMenuExpandedEntryId(null);
    }
  }, [insertMenu]);

  const clearViewportFocusSetupFrames = useCallback(() => {
    for (const frameId of viewportFocusSetupFrameIdsRef.current) {
      window.cancelAnimationFrame(frameId);
    }
    viewportFocusSetupFrameIdsRef.current = [];
  }, []);

  const cancelViewportFocusAnimation = useCallback(
    (options?: { clearPending?: boolean }) => {
      clearViewportFocusSetupFrames();
      if (viewportFocusAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFocusAnimationFrameRef.current);
        viewportFocusAnimationFrameRef.current = null;
      }
      if (options?.clearPending) {
        setPendingViewportFocusNodeId(null);
      }
    },
    [clearViewportFocusSetupFrames]
  );

  useEffect(() => {
    historyStacksRef.current = historyStacks;
  }, [historyStacks]);

  const persistCanvas = useCallback(
    async (doc: CanvasDocument) => {
      await putCanvasWorkspace(projectId, {
        canvasDocument: doc,
      });
    },
    [projectId]
  );

  const queueCanvasSave = useCallback(
    (doc: CanvasDocument) => {
      if (!hasLoadedCanvasRef.current) {
        pendingCanvasSaveRef.current = doc;
        return;
      }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        persistCanvas(doc).catch((error) => {
          console.error("Failed to persist canvas", error);
        });
      }, 360);
    },
    [persistCanvas]
  );

  const persistCanvasImmediately = useCallback(
    async (doc: CanvasDocument) => {
      if (!hasLoadedCanvasRef.current) {
        pendingCanvasSaveRef.current = doc;
        return;
      }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      await persistCanvas(doc);
    },
    [persistCanvas]
  );

  const setTrackedSelectedNodeIds = useCallback((nextSelectedNodeIds: string[]) => {
    selectedNodeIdsRef.current = nextSelectedNodeIds;
    setSelectedNodeIds(nextSelectedNodeIds);
  }, []);

  const setTrackedSelectedConnection = useCallback((nextSelectedConnection: CanvasConnection | null) => {
    selectedConnectionRef.current = nextSelectedConnection;
    setSelectedConnection(nextSelectedConnection);
  }, []);

  const syncHistoryStacks = useCallback((nextStacks: CanvasHistoryStacks) => {
    historyStacksRef.current = nextStacks;
    setHistoryStacks(nextStacks);
  }, []);

  const applyCanvasDocWithoutHistory = useCallback(
    (
      nextDoc: CanvasDocument,
      options?: {
        persist?: boolean;
        selectedNodeIds?: string[];
        selectedConnection?: CanvasConnection | null;
      }
    ) => {
      canvasDocRef.current = nextDoc;
      setCanvasDoc(nextDoc);
      if (options?.selectedNodeIds !== undefined) {
        setTrackedSelectedNodeIds(options.selectedNodeIds);
      }
      if (options?.selectedConnection !== undefined) {
        setTrackedSelectedConnection(options.selectedConnection);
      }
      if (options?.persist !== false) {
        queueCanvasSave(nextDoc);
      }
    },
    [queueCanvasSave, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const captureCanvasHistoryState = useCallback(
    (overrides?: Partial<CanvasHistoryState<CanvasConnection>>): CanvasHistoryState<CanvasConnection> => ({
      canvasDoc: overrides?.canvasDoc ?? canvasDocRef.current,
      selectedNodeIds: [...(overrides?.selectedNodeIds ?? selectedNodeIdsRef.current)],
      selectedConnection:
        overrides?.selectedConnection === undefined ? selectedConnectionRef.current : overrides.selectedConnection,
    }),
    []
  );

  const clearPendingCoalescedHistoryTimer = useCallback(() => {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
  }, []);

  const applyCanvasHistoryState = useCallback(
    (
      nextState: CanvasHistoryState<CanvasConnection>,
      options?: {
        persist?: boolean;
      }
    ) => {
      canvasDocRef.current = nextState.canvasDoc;
      setCanvasDoc(nextState.canvasDoc);
      setTrackedSelectedNodeIds(nextState.selectedNodeIds);
      setTrackedSelectedConnection(nextState.selectedConnection);

      if (options?.persist !== false) {
        queueCanvasSave(nextState.canvasDoc);
      }
    },
    [queueCanvasSave, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const commitPendingCoalescedHistory = useCallback(() => {
    clearPendingCoalescedHistoryTimer();

    const pendingEntry = pendingCoalescedHistoryRef.current;
    if (!pendingEntry) {
      return;
    }

    pendingCoalescedHistoryRef.current = null;
    const patch = createCanvasHistoryPatch(pendingEntry.beforeState, pendingEntry.afterState);
    if (!patch) {
      return;
    }

    syncHistoryStacks({
      undo: [...historyStacksRef.current.undo, patch].slice(-CANVAS_HISTORY_LIMIT),
      redo: [],
    });
  }, [clearPendingCoalescedHistoryTimer, syncHistoryStacks]);

  const scheduleCoalescedHistory = useCallback(
    (
      key: string,
      beforeState: CanvasHistoryState<CanvasConnection>,
      afterState: CanvasHistoryState<CanvasConnection>
    ) => {
      const pendingEntry = pendingCoalescedHistoryRef.current;
      if (pendingEntry && pendingEntry.key === key) {
        pendingCoalescedHistoryRef.current = {
          ...pendingEntry,
          afterState,
        };
      } else {
        commitPendingCoalescedHistory();
        pendingCoalescedHistoryRef.current = {
          key,
          beforeState,
          afterState,
        };
      }

      clearPendingCoalescedHistoryTimer();
      historyTimerRef.current = setTimeout(() => {
        commitPendingCoalescedHistory();
      }, COALESCED_HISTORY_DELAY_MS);
    },
    [clearPendingCoalescedHistoryTimer, commitPendingCoalescedHistory]
  );

  const recordImmediateHistory = useCallback(
    (
      beforeState: CanvasHistoryState<CanvasConnection>,
      afterState: CanvasHistoryState<CanvasConnection>
    ) => {
      commitPendingCoalescedHistory();
      const patch = createCanvasHistoryPatch(beforeState, afterState);
      if (!patch) {
        return;
      }

      syncHistoryStacks({
        undo: [...historyStacksRef.current.undo, patch].slice(-CANVAS_HISTORY_LIMIT),
        redo: [],
      });
    },
    [commitPendingCoalescedHistory, syncHistoryStacks]
  );

  const resetCanvasHistory = useCallback(() => {
    pendingCoalescedHistoryRef.current = null;
    clearPendingCoalescedHistoryTimer();
    syncHistoryStacks({
      undo: [],
      redo: [],
    });
  }, [clearPendingCoalescedHistoryTimer, syncHistoryStacks]);

  const runUserCanvasMutation = useCallback(
    (
      buildNextState: (
        currentState: CanvasHistoryState<CanvasConnection>
      ) =>
        | {
            canvasDoc: CanvasDocument;
            selectedNodeIds?: string[];
            selectedConnection?: CanvasConnection | null;
          }
        | null,
      options?: {
        historyMode?: "immediate" | "coalesced";
        historyKey?: string;
        persist?: boolean;
      }
    ) => {
      const beforeState = captureCanvasHistoryState();
      const nextStateCandidate = buildNextState(beforeState);
      if (!nextStateCandidate) {
        return false;
      }

      const afterState = captureCanvasHistoryState({
        canvasDoc: nextStateCandidate.canvasDoc,
        selectedNodeIds: nextStateCandidate.selectedNodeIds ?? beforeState.selectedNodeIds,
        selectedConnection:
          nextStateCandidate.selectedConnection === undefined
            ? beforeState.selectedConnection
            : nextStateCandidate.selectedConnection,
      });

      applyCanvasHistoryState(afterState, { persist: options?.persist });

      if (options?.historyMode === "coalesced" && options.historyKey) {
        scheduleCoalescedHistory(options.historyKey, beforeState, afterState);
      } else {
        recordImmediateHistory(beforeState, afterState);
      }

      return true;
    },
    [applyCanvasHistoryState, captureCanvasHistoryState, recordImmediateHistory, scheduleCoalescedHistory]
  );

  const modelCatalogVariants = useMemo(() => getModelCatalogVariants(providers), [providers]);
  const groupedModelCatalogVariants = useMemo(() => groupModelCatalogVariants(providers), [providers]);
  const defaultModelCatalogVariant = useMemo(() => getDefaultModelCatalogVariant(providers), [providers]);
  const copilotModelVariants = useMemo(() => getCanvasCopilotModelVariants(modelCatalogVariants), [modelCatalogVariants]);
  const defaultCopilotModelVariant = useMemo(
    () => getDefaultCanvasCopilotModelVariant(copilotModelVariants),
    [copilotModelVariants]
  );

  const providerModelDisplayNames = useMemo(() => {
    return providers.reduce<Record<string, string>>((acc, model) => {
      acc[`${model.providerId}:${model.modelId}`] = model.displayName;
      return acc;
    }, {});
  }, [providers]);

  useEffect(() => {
    if (copilotModelVariants.length === 0) {
      setCopilotModelVariantId(null);
      return;
    }

    if (copilotModelVariantId && copilotModelVariants.some((variant) => variant.id === copilotModelVariantId)) {
      return;
    }

    setCopilotModelVariantId(defaultCopilotModelVariant?.id || copilotModelVariants[0]?.id || null);
  }, [copilotModelVariantId, copilotModelVariants, defaultCopilotModelVariant]);

  const nodesById = useMemo(() => {
    return canvasDoc.workflow.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [canvasDoc.workflow.nodes]);
  const effectiveFullNodeId = activeFullNodeId || pinnedModelFullNodeId;

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((nodeId) => nodesById[nodeId])
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNodeIds]);

  const primarySelectedNodeId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;
  const activeNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null;

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === primarySelectedNodeId) || null,
    [canvasDoc.workflow.nodes, primarySelectedNodeId]
  );
  const activeSelectedNode = useMemo(
    () => (activeNodeId ? canvasDoc.workflow.nodes.find((node) => node.id === activeNodeId) || null : null),
    [activeNodeId, canvasDoc.workflow.nodes]
  );

  const selectedNodeIsList = selectedNode?.kind === "list";
  const selectedNodeIsTextTemplate = selectedNode?.kind === "text-template";
  const selectedNodeIsModel = selectedNode?.kind === "model";
  const selectedModel = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return undefined;
    }
    return providers.find(
      (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
    );
  }, [providers, selectedNode, selectedNodeIsModel]);

  const selectedNodeSourceJobId = useMemo(() => getNodeSourceJobId(selectedNode), [selectedNode]);

  const latestImageAssetByNodeId = useMemo(() => {
    const map = new Map<string, { assetId: string; mimeType: string | null; createdAtMs: number }>();

    for (const job of jobs) {
      if (job.state !== "succeeded") {
        continue;
      }
      const nodeId = job.nodeRunPayload?.nodeId;
      if (!nodeId) {
        continue;
      }

      for (const asset of job.assets || []) {
        if (asset.type !== "image") {
          continue;
        }

        const createdAtMs = new Date(asset.createdAt).getTime();
        const existing = map.get(nodeId);
        if (!existing || createdAtMs > existing.createdAtMs) {
          map.set(nodeId, { assetId: asset.id, mimeType: asset.mimeType || null, createdAtMs });
        }
      }
    }

    return map;
  }, [jobs]);

  const latestPreviewFrameByJobOutputKey = useMemo(() => {
    const map = new Map<string, PreviewFrameSummary>();

    for (const job of jobs) {
      for (const previewFrame of job.latestPreviewFrames || []) {
        const key = `${job.id}:${previewFrame.outputIndex}`;
        const existing = map.get(key);
        if (!existing || new Date(previewFrame.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
          map.set(key, previewFrame);
        }
      }
    }

    return map;
  }, [jobs]);

  const startedJobNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const job of jobs) {
      const nodeId = job.nodeRunPayload?.nodeId;
      if (nodeId) {
        ids.add(nodeId);
      }
    }
    return ids;
  }, [jobs]);

  const resolveNodeImageAsset = useCallback(
    (node: WorkflowNode | null | undefined) => {
      if (!node || node.outputType !== "image") {
        return null;
      }

      if (node.sourceAssetId) {
        return {
          assetId: node.sourceAssetId,
          mimeType: node.sourceAssetMimeType,
        };
      }

      const latest = latestImageAssetByNodeId.get(node.id);
      if (!latest) {
        return null;
      }

      return {
        assetId: latest.assetId,
        mimeType: latest.mimeType,
      };
    },
    [latestImageAssetByNodeId]
  );

  const getExecutionModeForModel = useCallback(
    (model: ProviderModel | undefined, upstreamNodeIds: string[]) => {
      if (isRunnableTextModel(model?.providerId, model?.modelId)) {
        return "generate" as const;
      }

      if (isRunnableTopazGigapixelModel(model?.providerId, model?.modelId)) {
        return "edit" as const;
      }

      const hasConnectedImageInputs = upstreamNodeIds.some((nodeId) => {
        const inputNode = nodesById[nodeId];
        const imageAsset = resolveNodeImageAsset(inputNode);
        return Boolean(imageAsset);
      });

      return hasConnectedImageInputs ? ("edit" as const) : ("generate" as const);
    },
    [nodesById, resolveNodeImageAsset]
  );

  const canvasNodes = useMemo(() => {
    return canvasDoc.workflow.nodes.map((node) => {
      const uploadedAssetAspectRatio = getUploadedAssetNodeAspectRatio(node) || undefined;
      const presentation = resolveCanvasNodePresentation({
        node,
        activeNodeId,
        fullNodeId: effectiveFullNodeId,
        nodeId: node.id,
        aspectRatio: uploadedAssetAspectRatio,
      });
      const displayModelName = providerModelDisplayNames[`${node.providerId}:${node.modelId}`] || node.modelId;
      const generatedProvenance = getGeneratedNodeProvenance(node);
      const inputSemanticTypes = sortSemanticTypes([
        ...(node.kind === "model" && node.promptSourceNodeId ? (["text"] as CanvasSemanticType[]) : []),
        ...node.upstreamNodeIds
          .map((nodeId) => nodesById[nodeId] || null)
          .filter((inputNode): inputNode is WorkflowNode => Boolean(inputNode))
          .map((inputNode) => getNodeSemanticOutputType(inputNode)),
      ]);

      if (!isGeneratedAssetNode(node)) {
        const listSettings = isListNode(node) ? getListNodeSettings(node.settings) : null;
        const connectedListNode =
          isTextTemplateNode(node) && node.upstreamNodeIds.length > 0
            ? canvasDoc.workflow.nodes.find((candidate) => candidate.id === node.upstreamNodeIds[0] && candidate.kind === "list") || null
            : null;
        const templatePreview =
          isTextTemplateNode(node) ? buildTextTemplatePreview(node.prompt, connectedListNode ? getListNodeSettings(connectedListNode.settings) : null) : null;
        const listPreviewColumns = listSettings?.columns.slice(0, 3).map((column) => column.label.trim() || "Untitled") || [];
        const listPreviewRows =
          listSettings?.rows.slice(0, 3).map((row) =>
            (listSettings.columns.length > 0 ? listSettings.columns : []).slice(0, 3).map((column) => {
              const value = String(row.values[column.id] ?? "").trim();
              return value || "—";
            })
          ) || [];

        return {
          ...node,
          presentation,
          renderMode: presentation.renderMode,
          canResize: presentation.canResize,
          lockAspectRatio: presentation.lockAspectRatio,
          resolvedSize: presentation.size,
          assetOrigin: node.kind === "asset-source" ? ("uploaded" as const) : null,
          sourceModelNodeId: getSourceModelNodeId(node),
          generatedProvenance,
          displayModelName:
            node.kind === "asset-source" ? null : node.kind === "list" ? "List" : node.kind === "text-template" ? "Template" : displayModelName,
          displaySourceLabel:
            node.kind === "asset-source"
              ? "Uploaded Asset"
              : node.kind === "list"
                ? `${listSettings?.columns.length || 0} col${listSettings?.columns.length === 1 ? "" : "s"}`
                : node.kind === "text-template"
                  ? templatePreview?.disabledReason
                    ? "Needs input"
                    : `${templatePreview?.nonBlankRowCount || 0} rows ready`
                  : displayModelName,
          inputSemanticTypes,
          outputSemanticType: getNodeSemanticOutputType(node),
          previewImageUrl: null,
          hasStartedJob: node.kind === "model" ? startedJobNodeIds.has(node.id) : true,
          listPreviewColumns,
          listPreviewRows,
          listRowCount: listSettings?.rows.length || 0,
          listColumnCount: listSettings?.columns.length || 0,
          templateRegisteredColumnCount: templatePreview?.columns.length || 0,
          templateUnresolvedCount: templatePreview?.unresolvedTokens.length || 0,
          templateReady: Boolean(templatePreview && !templatePreview.disabledReason),
          templateTokens:
            (templatePreview?.columns.length || 0) > 0
              ? (templatePreview?.columns || []).map((column) => column.label)
              : (templatePreview?.tokens || []).map((token) => token.label),
          templatePreviewRows: (templatePreview?.rows || []).slice(0, 4).map((row) => row.text),
          templateStatusMessage:
            templatePreview?.disabledReason || templatePreview?.readyMessage || null,
        };
      }

      const sourceJobId = getNodeSourceJobId(node);
      const sourceOutputIndex = getNodeSourceOutputIndex(node);
      const sourceModelNodeId = getSourceModelNodeId(node);
      if (!sourceJobId || typeof sourceOutputIndex !== "number") {
        return {
          ...node,
          presentation,
          renderMode: presentation.renderMode,
          canResize: presentation.canResize,
          lockAspectRatio: presentation.lockAspectRatio,
          resolvedSize: presentation.size,
          assetOrigin: "generated" as const,
          sourceModelNodeId,
          generatedProvenance,
          displayModelName,
          displaySourceLabel: displayModelName,
          inputSemanticTypes,
          outputSemanticType: getNodeSemanticOutputType(node),
        };
      }

      const previewFrame = latestPreviewFrameByJobOutputKey.get(`${sourceJobId}:${sourceOutputIndex}`);
      return {
        ...node,
        presentation,
        renderMode: presentation.renderMode,
        canResize: presentation.canResize,
        lockAspectRatio: presentation.lockAspectRatio,
        resolvedSize: presentation.size,
        assetOrigin: "generated" as const,
        sourceModelNodeId,
        generatedProvenance,
        displayModelName,
        displaySourceLabel: displayModelName,
        inputSemanticTypes,
        outputSemanticType: getNodeSemanticOutputType(node),
        previewImageUrl: previewFrame ? getPreviewFrameUrl(projectId, sourceJobId, previewFrame) : null,
        hasStartedJob: node.kind === "model" ? startedJobNodeIds.has(node.id) : true,
      };
    });
  }, [
    activeNodeId,
    canvasDoc.workflow.nodes,
    effectiveFullNodeId,
    latestPreviewFrameByJobOutputKey,
    nodesById,
    projectId,
    providerModelDisplayNames,
    startedJobNodeIds,
  ]);

  const resolveNodeImageAssetId = useCallback(
    (node: WorkflowNode | null | undefined) => resolveNodeImageAsset(node)?.assetId || null,
    [resolveNodeImageAsset]
  );

  const selectedImageAssetIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of selectedNodes) {
      const assetId = resolveNodeImageAssetId(node);
      if (!assetId || seen.has(assetId)) {
        continue;
      }
      ids.push(assetId);
      seen.add(assetId);
    }
    return ids;
  }, [resolveNodeImageAssetId, selectedNodes]);

  const selectedSingleImageAssetId = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }
    return resolveNodeImageAssetId(selectedNode);
  }, [resolveNodeImageAssetId, selectedNode, selectedNodeIds.length]);

  const selectedPromptSourceNode = useMemo(() => {
    if (!selectedNode?.promptSourceNodeId || !selectedNodeIsModel) {
      return null;
    }

    return canvasDoc.workflow.nodes.find((node) => node.id === selectedNode.promptSourceNodeId) || null;
  }, [canvasDoc.workflow.nodes, selectedNode?.promptSourceNodeId, selectedNodeIsModel]);

  const selectedInputNodes = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return selectedNode.upstreamNodeIds
      .map((nodeId) => nodesById[nodeId] || null)
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNode]);

  const selectedListSettings = useMemo<ListNodeSettings | null>(() => {
    if (!selectedNodeIsList || !selectedNode) {
      return null;
    }
    return getListNodeSettings(selectedNode.settings);
  }, [selectedNode, selectedNodeIsList]);

  const selectedTemplateListNode = useMemo(() => {
    if (!selectedNodeIsTextTemplate || !selectedNode) {
      return null;
    }

    return selectedInputNodes.find((node) => node.kind === "list") || null;
  }, [selectedInputNodes, selectedNode, selectedNodeIsTextTemplate]);

  const selectedTemplatePreview = useMemo(() => {
    if (!selectedNodeIsTextTemplate || !selectedNode) {
      return null;
    }

    return buildTextTemplatePreview(
      selectedNode.prompt,
      selectedTemplateListNode ? getListNodeSettings(selectedTemplateListNode.settings) : null
    );
  }, [selectedNode, selectedNodeIsTextTemplate, selectedTemplateListNode]);

  const selectedNodeExecutionMode = useMemo(() => {
    if (!selectedNodeIsModel || !selectedNode) {
      return "generate" as const;
    }

    return getExecutionModeForModel(selectedModel, selectedNode.upstreamNodeIds);
  }, [getExecutionModeForModel, selectedModel, selectedNode, selectedNodeIsModel]);

  const selectedNodeResolvedSettings = useMemo<Record<string, unknown>>(() => {
    if (!selectedNodeIsModel || !selectedNode) {
      return {};
    }
    return resolveModelSettings(selectedModel, selectedNode.settings, selectedNodeExecutionMode) as Record<string, unknown>;
  }, [selectedModel, selectedNode, selectedNodeExecutionMode, selectedNodeIsModel]);

  const selectedModelParameters = useMemo(() => {
    if (!selectedModel || !selectedNodeIsModel) {
      return [];
    }

    return (selectedModel.capabilities.parameters || []).filter((parameter) =>
      isModelParameterVisible(parameter, {
        executionMode: selectedNodeExecutionMode,
        settings: selectedNodeResolvedSettings,
      })
    );
  }, [selectedModel, selectedNodeExecutionMode, selectedNodeIsModel, selectedNodeResolvedSettings]);

  const selectedCoreParameters = useMemo(
    () => selectedModelParameters.filter((parameter) => parameter.section === "core"),
    [selectedModelParameters]
  );

  const selectedAdvancedParameters = useMemo(
    () => selectedModelParameters.filter((parameter) => parameter.section === "advanced"),
    [selectedModelParameters]
  );

  const fetchCanvas = useCallback(async () => {
    const data = await getCanvasWorkspace(projectId);
    const raw = (data.canvas?.canvasDocument || {}) as Record<string, unknown>;
    const viewportRaw = (raw.canvasViewport as Record<string, unknown> | undefined) || {};
    const savedGeneratedOutputReceiptKeys = Array.isArray(raw.generatedOutputReceiptKeys)
      ? raw.generatedOutputReceiptKeys
          .map((value) => (typeof value === "string" ? value : null))
          .filter((value): value is string => Boolean(value))
      : [];
    const nodesRaw = Array.isArray((raw.workflow as Record<string, unknown> | undefined)?.nodes)
      ? (((raw.workflow as Record<string, unknown>).nodes as unknown[]) || [])
      : [];

    const nodes = nodesRaw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((node, index) => normalizeNode(node, index));
    const nextGeneratedOutputReceiptKeys = [
      ...new Set([...savedGeneratedOutputReceiptKeys, ...getLegacyGeneratedOutputReceiptKeys(nodes)]),
    ].sort();
    const didMigrateGeneratedOutputReceipts =
      JSON.stringify([...new Set(savedGeneratedOutputReceiptKeys)].sort()) !==
      JSON.stringify(nextGeneratedOutputReceiptKeys);

    const nextDoc: CanvasDocument = {
      canvasViewport: {
        x: typeof viewportRaw.x === "number" ? viewportRaw.x : defaultCanvasDocument.canvasViewport.x,
        y: typeof viewportRaw.y === "number" ? viewportRaw.y : defaultCanvasDocument.canvasViewport.y,
        zoom:
          typeof viewportRaw.zoom === "number"
            ? viewportRaw.zoom
            : defaultCanvasDocument.canvasViewport.zoom,
      },
      generatedOutputReceiptKeys: nextGeneratedOutputReceiptKeys,
      workflow: {
        nodes,
      },
    };

    canvasDocRef.current = nextDoc;
    setCanvasDoc(nextDoc);
    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(selectedNodeIdsRef.current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
    setActiveFullNodeId(null);
    resetCanvasHistory();

    hasLoadedCanvasRef.current = true;

    if (didMigrateGeneratedOutputReceipts) {
      await persistCanvas(nextDoc);
    }

    if (pendingCanvasSaveRef.current) {
      const pendingDoc = pendingCanvasSaveRef.current;
      pendingCanvasSaveRef.current = null;
      await persistCanvas(pendingDoc);
    }
  }, [persistCanvas, projectId, resetCanvasHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const fetchJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

  const selectSingleNode = useCallback((nodeId: string | null) => {
    commitPendingCoalescedHistory();
    if (!nodeId) {
      setTrackedSelectedConnection(null);
      setTrackedSelectedNodeIds([]);
      return;
    }

    const didPromote = runUserCanvasMutation((currentState) => {
      const nextNodes = promoteCanvasNodesToFront(currentState.canvasDoc.workflow.nodes, [nodeId]);
      if (!nextNodes) {
        return null;
      }

      return {
        canvasDoc: {
          ...currentState.canvasDoc,
          workflow: {
            nodes: nextNodes,
          },
        },
        selectedNodeIds: [nodeId],
        selectedConnection: null,
      };
    });

    if (!didPromote) {
      setTrackedSelectedConnection(null);
      setTrackedSelectedNodeIds([nodeId]);
    }
  }, [commitPendingCoalescedHistory, runUserCanvasMutation, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    commitPendingCoalescedHistory();
    const isSelected = selectedNodeIdsRef.current.includes(nodeId);
    const nextSelectedNodeIds = isSelected
      ? selectedNodeIdsRef.current.filter((id) => id !== nodeId)
      : [...selectedNodeIdsRef.current, nodeId];

    if (!isSelected) {
      const didPromote = runUserCanvasMutation((currentState) => {
        const nextNodes = promoteCanvasNodesToFront(currentState.canvasDoc.workflow.nodes, [nodeId]);
        if (!nextNodes) {
          return null;
        }

        return {
          canvasDoc: {
            ...currentState.canvasDoc,
            workflow: {
              nodes: nextNodes,
            },
          },
          selectedNodeIds: nextSelectedNodeIds,
          selectedConnection: null,
        };
      });

      if (didPromote) {
        setActiveFullNodeId(null);
        return;
      }
    }

    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(nextSelectedNodeIds);
    setActiveFullNodeId(null);
  }, [commitPendingCoalescedHistory, runUserCanvasMutation, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const addNodesToSelection = useCallback((nodeIds: string[]) => {
    commitPendingCoalescedHistory();
    const seen = new Set(selectedNodeIdsRef.current);
    const merged = [...selectedNodeIdsRef.current];
    const newlyAddedNodeIds: string[] = [];
    for (const nodeId of nodeIds) {
      if (seen.has(nodeId)) {
        continue;
      }
      seen.add(nodeId);
      merged.push(nodeId);
      newlyAddedNodeIds.push(nodeId);
    }

    if (newlyAddedNodeIds.length > 0) {
      const didPromote = runUserCanvasMutation((currentState) => {
        const nextNodes = promoteCanvasNodesToFront(currentState.canvasDoc.workflow.nodes, newlyAddedNodeIds);
        if (!nextNodes) {
          return null;
        }

        return {
          canvasDoc: {
            ...currentState.canvasDoc,
            workflow: {
              nodes: nextNodes,
            },
          },
          selectedNodeIds: merged,
          selectedConnection: null,
        };
      });

      if (didPromote) {
        setActiveFullNodeId(null);
        return;
      }
    }

    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(merged);
    setActiveFullNodeId(null);
  }, [commitPendingCoalescedHistory, runUserCanvasMutation, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const selectCanvasConnection = useCallback(
    (nextConnection: CanvasConnection | null) => {
      commitPendingCoalescedHistory();
      setTrackedSelectedConnection(nextConnection);
      if (nextConnection) {
        setTrackedSelectedNodeIds([]);
      }
      setActiveFullNodeId(null);
    },
    [commitPendingCoalescedHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const buildNodeRunRequest = useCallback(
    (node: WorkflowNode) => {
      const model = providers.find(
        (providerModel) => providerModel.providerId === node.providerId && providerModel.modelId === node.modelId
      );
      const isTextModel = isRunnableTextModel(model?.providerId, model?.modelId);
      const promptSourceNode = node.promptSourceNodeId ? nodesById[node.promptSourceNodeId] || null : null;
      const prompt = node.promptSourceNodeId ? (promptSourceNode?.prompt || "") : node.prompt;
      const maxInputImages = model?.capabilities.maxInputImages || 0;
      const acceptedMimeTypes = new Set(model?.capabilities.acceptedInputMimeTypes || []);
      const connectedImageRefs = (isTextModel ? [] : node.upstreamNodeIds)
        .map((nodeId) => nodesById[nodeId] || null)
        .map((inputNode) => (inputNode ? resolveNodeImageAsset(inputNode) : null))
        .filter((assetRef): assetRef is NonNullable<ReturnType<typeof resolveNodeImageAsset>> => Boolean(assetRef));

      const inputImageAssetIds = isTextModel
        ? []
        : connectedImageRefs
            .filter((assetRef) => {
              if (acceptedMimeTypes.size === 0) {
                return true;
              }
              return Boolean(assetRef.mimeType && acceptedMimeTypes.has(assetRef.mimeType));
            })
            .map((assetRef) => assetRef.assetId)
            .filter((assetId, index, array) => array.indexOf(assetId) === index)
            .slice(0, maxInputImages || undefined);
      const executionMode = getExecutionModeForModel(model, node.upstreamNodeIds);
      const effectiveSettings = resolveModelSettings(model, node.settings, executionMode);
      const resolvedTextSettings = isTextModel
        ? resolveTextModelSettings(model?.providerId, model?.modelId, effectiveSettings)
        : null;
      const outputCount =
        resolveImageModelSettings(model?.providerId, model?.modelId, effectiveSettings, executionMode)?.outputCount || 1;

      const requestPayload = {
        providerId: node.providerId,
        modelId: node.modelId,
        nodePayload: {
          nodeId: node.id,
          nodeType: node.nodeType as RunnableWorkflowNodeType,
          prompt: prompt.trim(),
          settings: effectiveSettings,
          outputType: node.outputType,
          executionMode,
          outputCount,
          runOrigin: "canvas-node" as const,
          promptSourceNodeId: node.promptSourceNodeId,
          upstreamNodeIds: node.upstreamNodeIds,
          upstreamAssetIds: inputImageAssetIds,
          inputImageAssetIds,
        },
      } as const;

      let disabledReason: string | null = null;
      let readyMessage: string | null = null;
      if (!model) {
        disabledReason = "Selected model is unavailable.";
      } else if (model.capabilities.availability !== "ready") {
        disabledReason = `${model.displayName} is coming soon.`;
      } else if (getFirstUnconfiguredRequirement(model.capabilities)) {
        disabledReason =
          formatProviderRequirementMessage(getFirstUnconfiguredRequirement(model.capabilities)) ||
          `${model.displayName} is not runnable right now.`;
      } else if (isProviderAccessBlocked(model.capabilities)) {
        disabledReason = formatProviderAccessMessage(model.capabilities) || `${model.displayName} is not runnable right now.`;
      } else if (!model.capabilities.executionModes.includes(executionMode)) {
        disabledReason = `${model.displayName} does not support ${executionMode} mode.`;
      } else if (
        model.capabilities.promptMode === "required" &&
        !requestPayload.nodePayload.prompt
      ) {
        disabledReason = node.promptSourceNodeId
          ? "Connected text note is empty."
          : "Connect a prompt note or enter a prompt.";
      } else if (
        model.capabilities.promptMode === "unsupported" &&
        (Boolean(node.promptSourceNodeId) || Boolean(requestPayload.nodePayload.prompt))
      ) {
        disabledReason = `${model.displayName} does not support prompt input.`;
      } else if (isTextModel && (node.upstreamNodeIds.length > 0 || node.upstreamAssetIds.length > 0)) {
        disabledReason = `${model.displayName} only accepts prompt text, not connected asset inputs.`;
      } else if (resolvedTextSettings?.validationError) {
        disabledReason = resolvedTextSettings.validationError;
      } else if (connectedImageRefs.length > 0 && requestPayload.nodePayload.inputImageAssetIds.length === 0) {
        disabledReason =
          acceptedMimeTypes.size > 0
            ? "Connected image inputs are unsupported. Use PNG, JPEG, or TIFF references."
            : "Connected image inputs are unsupported for this model.";
      } else if (isRunnableTopazGigapixelModel(model.providerId, model.modelId) && inputImageAssetIds.length !== 1) {
        disabledReason = `${model.displayName} requires exactly one connected PNG, JPEG, or TIFF image input.`;
      } else if (isRunnableTopazGigapixelModel(model.providerId, model.modelId) && outputCount !== 1) {
        disabledReason = `${model.displayName} produces exactly one output.`;
      } else {
        if (isRunnableTopazGigapixelModel(model.providerId, model.modelId)) {
          const resolvedTopazSettings = resolveTopazGigapixelSettings(effectiveSettings, model.modelId);
          readyMessage =
            model.capabilities.promptMode === "optional" && requestPayload.nodePayload.prompt
              ? `Ready to run ${model.displayName} at ${resolvedTopazSettings.scale}x on 1 image with prompt guidance.`
              : `Ready to run ${model.displayName} at ${resolvedTopazSettings.scale}x on 1 image.`;
        } else if (isTextModel) {
          const textOutputTarget = readOpenAiTextOutputTarget(effectiveSettings.textOutputTarget);
          readyMessage =
            textOutputTarget === "smart"
              ? `Ready to generate ${getOpenAiTextOutputTargetLabel(textOutputTarget)} with ${model.displayName}. Explicit node instructions take priority. Allowed node kinds: text note, list, template.`
              : `Ready to generate ${getOpenAiTextOutputTargetLabel(textOutputTarget)} with ${model.displayName}.`;
        } else {
          readyMessage =
            executionMode === "generate"
              ? `Ready for prompt-only generation with ${outputCount} output${outputCount === 1 ? "" : "s"}.`
              : `Ready for reference-image generation from ${requestPayload.nodePayload.inputImageAssetIds.length} image input${
                  requestPayload.nodePayload.inputImageAssetIds.length === 1 ? "" : "s"
                } and ${outputCount} output${outputCount === 1 ? "" : "s"}.`;
        }
      }

      const debugRequest = buildProviderDebugRequest({
        providerId: node.providerId,
        modelId: node.modelId,
        prompt: requestPayload.nodePayload.prompt,
        executionMode,
        rawSettings: requestPayload.nodePayload.settings,
        inputImageAssetIds,
        inputAssets: connectedImageRefs
          .filter(
            (assetRef): assetRef is typeof assetRef & { mimeType: string } => typeof assetRef.mimeType === "string"
          )
          .map((assetRef) => ({
            assetId: assetRef.assetId,
            mimeType: assetRef.mimeType,
            width: null,
            height: null,
          })),
      });

      return {
        requestPayload,
        disabledReason,
        readyMessage,
        endpoint:
          debugRequest?.endpoint ||
          (isTextModel
            ? "ai.models.generateContent"
            : executionMode === "generate"
              ? "ai.models.generateContent"
              : "ai.models.generateContent"),
        debugRequest,
      };
    },
    [getExecutionModeForModel, nodesById, providers, resolveNodeImageAsset]
  );

  const selectedNodeRunPreview = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return null;
    }

    return buildNodeRunRequest(selectedNode);
  }, [buildNodeRunRequest, selectedNode, selectedNodeIsModel]);

  const copilotRunPreview = useMemo(
    () =>
      buildCanvasCopilotRunPreview({
        providers,
        variants: modelCatalogVariants,
        selectedVariantId: copilotModelVariantId,
        prompt: copilotDraft,
        requestNodeId: "canvas-copilot-preview",
      }),
    [copilotDraft, copilotModelVariantId, modelCatalogVariants, providers]
  );

  useEffect(() => {
    if (activeFullNodeId && !nodesById[activeFullNodeId]) {
      setActiveFullNodeId(null);
    }
  }, [activeFullNodeId, nodesById]);

  useEffect(() => {
    if (pinnedModelFullNodeId && !nodesById[pinnedModelFullNodeId]) {
      setPinnedModelFullNodeId(null);
    }
  }, [nodesById, pinnedModelFullNodeId]);

  useEffect(() => {
    setIsLoading(true);
    hasLoadedCanvasRef.current = false;
    pendingCanvasSaveRef.current = null;
    setCopilotOpen(false);
    setCopilotDraft("");
    setCopilotMessages([]);
    setCopilotActiveJobId(null);

    Promise.all([getProviders(), fetchCanvas(), fetchJobs(), openProject(projectId)])
      .then(([nextProviders]) => {
        setProviders(nextProviders);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [fetchCanvas, fetchJobs, projectId]);

  useEffect(() => {
    return subscribeToAppEvent("workspace.changed", (payload) => {
      if (payload.projectId !== projectId || payload.reason !== "asset-import") {
        return;
      }

      fetchCanvas().catch((error) => {
        console.error("Failed to refresh canvas after external asset import", error);
      });
    });
  }, [fetchCanvas, projectId]);

  useEffect(() => {
    const hasActiveJobs = jobs.some((job) => job.state === "queued" || job.state === "running");
    const interval = setInterval(() => {
      fetchJobs().catch(console.error);
    }, hasActiveJobs ? 900 : 2500);

    return () => clearInterval(interval);
  }, [fetchJobs, jobs]);

  useEffect(() => {
    if (!selectedConnection) {
      return;
    }

    const targetNode = canvasDoc.workflow.nodes.find((node) => node.id === selectedConnection.targetNodeId);
    if (!targetNode) {
      setTrackedSelectedConnection(null);
      return;
    }

    const exists =
      selectedConnection.kind === "prompt"
        ? targetNode.promptSourceNodeId === selectedConnection.sourceNodeId
        : targetNode.upstreamNodeIds.includes(selectedConnection.sourceNodeId);

    if (!exists) {
      setTrackedSelectedConnection(null);
    }
  }, [canvasDoc.workflow.nodes, selectedConnection, setTrackedSelectedConnection]);

  useEffect(() => {
    if (jobs.length === 0 || !hasLoadedCanvasRef.current) {
      return;
    }

    const prev = canvasDocRef.current;
    let workingNodes = [...prev.workflow.nodes];
    const nextGeneratedOutputReceiptKeys = getCanvasGeneratedOutputReceiptKeys(prev);
    let didChange = false;
    let didReceiptChange = false;
    let nextSelectedNodeIds = [...selectedNodeIdsRef.current];

    const replaceSelectedNodeId = (nodeId: string, nextNodeId: string) => {
      nextSelectedNodeIds = nextSelectedNodeIds.map((selectedNodeId) => (selectedNodeId === nodeId ? nextNodeId : selectedNodeId));
    };

    const filterWorkingNodes = (predicate: (node: WorkflowNode) => boolean) => {
      const removedIds: string[] = [];
      const nextNodes = workingNodes.filter((node) => {
        if (!predicate(node)) {
          removedIds.push(node.id);
          return false;
        }
        return true;
      });

      if (removedIds.length === 0) {
        return;
      }

      workingNodes = nextNodes;
      nextSelectedNodeIds = nextSelectedNodeIds.filter((selectedNodeId) => !removedIds.includes(selectedNodeId));
      didChange = true;
    };

    const upsertWorkingNode = (nextNode: WorkflowNode) => {
      const currentIndex = workingNodes.findIndex((candidate) => candidate.id === nextNode.id);
      if (currentIndex === -1) {
        workingNodes = [...workingNodes, nextNode];
        didChange = true;
        return;
      }

      if (JSON.stringify(workingNodes[currentIndex]) === JSON.stringify(nextNode)) {
        return;
      }

      workingNodes = workingNodes.map((candidate, index) => (index === currentIndex ? nextNode : candidate));
      didChange = true;
    };

    const existingGeneratedImageCountByModelNodeId = new Map<string, number>();
    const existingGeneratedTextCountByModelNodeId = new Map<string, number>();
    for (const node of workingNodes) {
      if (isGeneratedAssetNode(node)) {
        const sourceModelNodeId =
          typeof node.settings.sourceModelNodeId === "string" ? node.settings.sourceModelNodeId : null;
        if (!sourceModelNodeId) {
          continue;
        }
        existingGeneratedImageCountByModelNodeId.set(
          sourceModelNodeId,
          (existingGeneratedImageCountByModelNodeId.get(sourceModelNodeId) || 0) + 1
        );
        continue;
      }

      const generatedSettings = getGeneratedModelNodeSource(node.settings);
      if (!generatedSettings) {
        continue;
      }

      if (!generatedSettings.sourceModelNodeId) {
        continue;
      }

      existingGeneratedTextCountByModelNodeId.set(
        generatedSettings.sourceModelNodeId,
        (existingGeneratedTextCountByModelNodeId.get(generatedSettings.sourceModelNodeId) || 0) + 1
      );
    }

    const insertedGeneratedImageCountByModelNodeId = new Map<string, number>();
    const insertedGeneratedTextCountByModelNodeId = new Map<string, number>();
    const copilotJobSummaries = new Map<string, CanvasCopilotHydrationSummary>();
    const activeCanvasNodeId = selectedNodeIdsRef.current.length === 1 ? selectedNodeIdsRef.current[0]! : null;
    let copilotAnchorIndex = 0;

    const getCopilotInsertAnchor = () => {
      const offsetIndex = copilotAnchorIndex++;
      const rect = canvasSurfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        const fallbackPosition = nextCanvasNodePosition(workingNodes.length);
        return {
          x: fallbackPosition.x + (offsetIndex % 2) * 56,
          y: fallbackPosition.y + (Math.floor(offsetIndex / 2) % 2) * 40,
        };
      }

      return {
        x: Math.round((rect.width / 2 - prev.canvasViewport.x) / prev.canvasViewport.zoom + (offsetIndex % 2) * 56),
        y: Math.round(
          (rect.height / 2 - prev.canvasViewport.y) / prev.canvasViewport.zoom + (Math.floor(offsetIndex / 2) % 2) * 40
        ),
      };
    };

    for (const job of jobs) {
      const runOrigin = job.nodeRunPayload?.runOrigin === "copilot" ? "copilot" : "canvas-node";
      const isCopilotJob = runOrigin === "copilot";
      const sourceNodeId = job.nodeRunPayload?.nodeId;
      const modelNode =
        !isCopilotJob && sourceNodeId
          ? workingNodes.find((node) => node.id === sourceNodeId && node.kind === "model") || null
          : null;
      const modelSpawnAnchor =
        !isCopilotJob && modelNode
          ? getGeneratedModelSpawnAnchor({
              modelNode,
              activeNodeId: activeCanvasNodeId,
              fullNodeId: effectiveFullNodeId,
            })
          : null;

      if (!isCopilotJob && (!sourceNodeId || !modelNode)) {
        continue;
      }

      if (job.nodeRunPayload?.outputType === "image") {
        if (isCopilotJob || !sourceNodeId || !modelNode) {
          continue;
        }

        const expectedOutputCount = getExpectedGeneratedOutputCount(job);
        if (expectedOutputCount <= 0) {
          continue;
        }

        for (let outputIndex = 0; outputIndex < expectedOutputCount; outputIndex += 1) {
          const receiptKey = getGeneratedOutputReceiptKey({
            sourceJobId: job.id,
            outputIndex,
            descriptorIndex: 0,
          });
          const matchingImageAsset = findMatchingGeneratedImageAsset(job, outputIndex);
          const receiptNodes = workingNodes.filter((node) => getGeneratedOutputReceiptKeyForNode(node) === receiptKey);
          const hydratedReceiptNode =
            receiptNodes.find(
              (node) =>
                node.kind === "asset-source" &&
                node.outputType === "image" &&
                Boolean(node.sourceAssetId) &&
                node.processingState === null &&
                (!matchingImageAsset || node.sourceAssetId === matchingImageAsset.id)
            ) || null;
          const repairableReceiptNode =
            matchingImageAsset
              ? receiptNodes.find((node) => needsGeneratedImageNodeHydration(node, matchingImageAsset)) || null
              : null;
          const pendingNode = repairableReceiptNode || hydratedReceiptNode || receiptNodes[0] || null;
          const duplicateReceiptNodes = receiptNodes.filter((node) => node.id !== pendingNode?.id);
          const nextProcessingState =
            job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null;

          if (
            shouldSkipConsumedGeneratedImageReceipt({
              receiptConsumed: nextGeneratedOutputReceiptKeys.has(receiptKey),
              receiptNodes,
              matchingImageAsset,
            })
          ) {
            if (duplicateReceiptNodes.length > 0) {
              filterWorkingNodes((node) => !duplicateReceiptNodes.some((candidate) => candidate.id === node.id));
            }
            continue;
          }

          if (job.state === "succeeded" && matchingImageAsset) {
            const visualIndex =
              (existingGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) +
              (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0);
            const baseNode = createGeneratedOutputNode(
              modelNode,
              job,
              sourceNodeId,
              pendingNode?.zIndex ?? nextCanvasNodeZIndex(workingNodes),
              outputIndex,
              visualIndex,
              buildGeneratedImageOutputPosition(modelSpawnAnchor!, visualIndex)
            );
            const finalNode = hydrateGeneratedImageNode({
              baseNode,
              pendingNode,
              providerId: job.providerId as WorkflowNode["providerId"],
              modelId: job.modelId,
              sourceJobId: job.id,
              outputIndex,
              sourceModelNodeId: sourceNodeId,
              matchingImageAsset,
            });

            if (!pendingNode) {
              insertedGeneratedImageCountByModelNodeId.set(
                sourceNodeId,
                (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) + 1
              );
            }

            upsertWorkingNode(finalNode);
            if (duplicateReceiptNodes.length > 0) {
              filterWorkingNodes((node) => !duplicateReceiptNodes.some((candidate) => candidate.id === node.id));
            }
            if (!nextGeneratedOutputReceiptKeys.has(receiptKey)) {
              nextGeneratedOutputReceiptKeys.add(receiptKey);
              didReceiptChange = true;
            }
            continue;
          }

          if (job.state === "canceled") {
            if (receiptNodes.length > 0) {
              filterWorkingNodes((node) => !receiptNodes.some((candidate) => candidate.id === node.id));
            }
            continue;
          }

          if (!pendingNode) {
            const visualIndex =
              (existingGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) +
              (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0);
            const outputNode = createGeneratedOutputNode(
              modelNode,
              job,
              sourceNodeId,
              nextCanvasNodeZIndex(workingNodes),
              outputIndex,
              visualIndex,
              buildGeneratedImageOutputPosition(modelSpawnAnchor!, visualIndex)
            );
            upsertWorkingNode(outputNode);
            insertedGeneratedImageCountByModelNodeId.set(
              sourceNodeId,
              (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) + 1
            );
            continue;
          }

          const nextPendingNode: WorkflowNode = {
            ...pendingNode,
            providerId: job.providerId as WorkflowNode["providerId"],
            modelId: job.modelId,
            processingState: nextProcessingState,
            sourceAssetId: matchingImageAsset?.id || pendingNode.sourceAssetId,
            sourceAssetMimeType: matchingImageAsset?.mimeType || pendingNode.sourceAssetMimeType,
            settings: {
              ...pendingNode.settings,
              source: "generated",
              sourceJobId: job.id,
              outputIndex,
              sourceModelNodeId:
                typeof pendingNode.settings.sourceModelNodeId === "string"
                  ? pendingNode.settings.sourceModelNodeId
                  : sourceNodeId,
            },
          };
          upsertWorkingNode(nextPendingNode);
          if (duplicateReceiptNodes.length > 0) {
            filterWorkingNodes((node) => !duplicateReceiptNodes.some((candidate) => candidate.id === node.id));
          }
        }
      }

      const textOutputTarget = job.textOutputTarget || getTextOutputTargetFromSettings(job.nodeRunPayload?.settings);
      const generatedNodeDescriptors = job.generatedNodeDescriptors || [];
      const shouldHydrateTextOutputs =
        job.nodeRunPayload?.outputType === "text" || generatedNodeDescriptors.length > 0;

      if (!shouldHydrateTextOutputs) {
        continue;
      }

      if (job.state === "succeeded") {
        const descriptorsToSpawn = textOutputTarget === "smart" ? generatedNodeDescriptors : generatedNodeDescriptors.slice(0, 1);
        const descriptorNodeIds = new Map<string, string>();
        const createdNodeIds: string[] = [];
        let connectedCount = 0;
        let skippedConnectionCount = 0;
        const smartPlaceholderReceiptKey =
          !isCopilotJob && textOutputTarget === "smart"
            ? getGeneratedOutputReceiptKey({
                sourceJobId: job.id,
                outputIndex: 0,
                descriptorIndex: 0,
              })
            : null;
        const genericSmartPlaceholderNodes =
          smartPlaceholderReceiptKey && !isCopilotJob
            ? workingNodes.filter(
                (node) =>
                  getGeneratedOutputReceiptKeyForNode(node) === smartPlaceholderReceiptKey &&
                  !isConsumedGeneratedOutputNode(node, nextGeneratedOutputReceiptKeys)
              )
            : [];
        const genericSmartPlaceholderNode =
          textOutputTarget === "smart" && genericSmartPlaceholderNodes.length > 0 ? genericSmartPlaceholderNodes[0]! : null;
        let claimedGenericSmartPlaceholderId: string | null = null;
        let ignoreGenericSmartPlaceholder = false;
        const copilotAnchor = isCopilotJob ? getCopilotInsertAnchor() : null;

        for (const [descriptorOrderIndex, descriptor] of descriptorsToSpawn.entries()) {
          const receiptKey = getGeneratedOutputReceiptKey(descriptor);
          const pendingNodes = workingNodes.filter(
            (node) =>
              getGeneratedOutputReceiptKeyForNode(node) === receiptKey &&
              !isConsumedGeneratedOutputNode(node, nextGeneratedOutputReceiptKeys)
          );
          const exactPendingNode = pendingNodes[0] || null;

          if (nextGeneratedOutputReceiptKeys.has(receiptKey)) {
            if (pendingNodes.length > 0) {
              filterWorkingNodes((node) => !pendingNodes.some((candidate) => candidate.id === node.id));
            }
            continue;
          }

          const visualIndex = isCopilotJob
            ? descriptor.descriptorIndex
            : (existingGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0) +
              (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0);
          const placement = isCopilotJob
            ? null
            : resolveGeneratedTextNodePlacement({
                descriptorOrderIndex,
                fallbackVisualIndex: visualIndex,
                exactPendingNode,
                genericSmartPlaceholderNode: ignoreGenericSmartPlaceholder ? null : genericSmartPlaceholderNode,
                allowGenericSmartPlaceholder:
                  !ignoreGenericSmartPlaceholder &&
                  Boolean(genericSmartPlaceholderNode) &&
                  (descriptorOrderIndex === 0 || claimedGenericSmartPlaceholderId === genericSmartPlaceholderNode?.id),
                modelAnchor: modelSpawnAnchor!,
              });
          const pendingNode = placement?.pendingNode || null;
          const duplicatePendingNodes = pendingNodes.filter((node) => node.id !== pendingNode?.id);
          const finalNode = createGeneratedModelNode({
            id: uid(),
            providerId: (isCopilotJob ? job.providerId : modelNode!.providerId) as WorkflowNode["providerId"],
            modelId: isCopilotJob ? job.modelId : modelNode!.modelId,
            modelNodeId: isCopilotJob ? null : sourceNodeId!,
            label: descriptor.label || getGeneratedDescriptorDefaultLabel(descriptor.kind, visualIndex),
            position: pendingNode
              ? {
                  x: pendingNode.x,
                  y: pendingNode.y,
                }
              : isCopilotJob && copilotAnchor
                ? buildCopilotGeneratedNodePosition(copilotAnchor, descriptor.descriptorIndex)
                : placement!.position,
            zIndex: pendingNode?.zIndex ?? nextCanvasNodeZIndex(workingNodes),
            processingState: null,
            descriptor,
            connectToSourceModel: shouldConnectGeneratedDescriptorToSourceModel({
              descriptorId: descriptor.descriptorId,
              generatedConnections: job.generatedConnections,
              runOrigin,
            }),
          });

          if (placement?.ignoreGenericSmartPlaceholder && genericSmartPlaceholderNodes.length > 0) {
            const exactPendingNodeId = exactPendingNode?.id || null;
            filterWorkingNodes(
              (node) =>
                !genericSmartPlaceholderNodes.some(
                  (candidate) => candidate.id === node.id && candidate.id !== exactPendingNodeId
                )
            );
            ignoreGenericSmartPlaceholder = true;
          }

          if (pendingNode) {
            filterWorkingNodes((node) => node.id !== pendingNode.id);
            replaceSelectedNodeId(pendingNode.id, finalNode.id);
          } else if (!isCopilotJob) {
            insertedGeneratedTextCountByModelNodeId.set(
              sourceNodeId!,
              (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0) + 1
            );
          }
          if (duplicatePendingNodes.length > 0) {
            filterWorkingNodes((node) => !duplicatePendingNodes.some((candidate) => candidate.id === node.id));
          }
          if (placement?.claimsGenericSmartPlaceholder && genericSmartPlaceholderNode) {
            claimedGenericSmartPlaceholderId = genericSmartPlaceholderNode.id;
            const duplicateGenericPlaceholderNodes = genericSmartPlaceholderNodes.filter(
              (node) => node.id !== genericSmartPlaceholderNode.id
            );
            if (duplicateGenericPlaceholderNodes.length > 0) {
              filterWorkingNodes((node) => !duplicateGenericPlaceholderNodes.some((candidate) => candidate.id === node.id));
            }
          }

          upsertWorkingNode(finalNode);
          descriptorNodeIds.set(descriptor.descriptorId, finalNode.id);
          createdNodeIds.push(finalNode.id);
          nextGeneratedOutputReceiptKeys.add(receiptKey);
          didReceiptChange = true;
        }

        if (textOutputTarget === "smart" && (job.generatedConnections || []).length > 0) {
          for (const connection of job.generatedConnections || []) {
            const sourceGeneratedNodeId = descriptorNodeIds.get(connection.sourceDescriptorId);
            const targetGeneratedNodeId = descriptorNodeIds.get(connection.targetDescriptorId);
            if (!sourceGeneratedNodeId || !targetGeneratedNodeId) {
              skippedConnectionCount += 1;
              continue;
            }

            const result = applyCanvasNodeConnection(
              workingNodes,
              sourceGeneratedNodeId,
              targetGeneratedNodeId,
              connection.kind
            );
            if (!result.applied) {
              skippedConnectionCount += 1;
              continue;
            }

            workingNodes = result.nodes;
            didChange = true;
            connectedCount += 1;
          }
        }

        if (isCopilotJob) {
          copilotJobSummaries.set(job.id, {
            addedNodeCount: createdNodeIds.length,
            connectedCount,
            skippedConnectionCount,
          });
          if (createdNodeIds.length > 0) {
            nextSelectedNodeIds = createdNodeIds;
          }
        }
        continue;
      }

      if (job.state === "canceled") {
        if (isCopilotJob) {
          continue;
        }
        filterWorkingNodes(
          (node) => getNodeSourceJobId(node) !== job.id || isConsumedGeneratedOutputNode(node, nextGeneratedOutputReceiptKeys)
        );
        continue;
      }

      if (isCopilotJob) {
        continue;
      }

      const placeholderTarget: GeneratedTextPlaceholderTarget =
        textOutputTarget === "list"
          ? "list"
          : textOutputTarget === "template"
            ? "template"
            : textOutputTarget === "smart"
              ? "smart"
              : "note";
      const placeholderReceiptKey = getGeneratedOutputReceiptKey({
        sourceJobId: job.id,
        outputIndex: 0,
        descriptorIndex: 0,
      });
      const pendingNodes = workingNodes.filter(
        (node) =>
          getGeneratedOutputReceiptKeyForNode(node) === placeholderReceiptKey &&
          !isConsumedGeneratedOutputNode(node, nextGeneratedOutputReceiptKeys)
      );
      const pendingNode = pendingNodes[0] || null;

      if (nextGeneratedOutputReceiptKeys.has(placeholderReceiptKey)) {
        if (pendingNodes.length > 0) {
          filterWorkingNodes((node) => !pendingNodes.some((candidate) => candidate.id === node.id));
        }
        continue;
      }

      const nextProcessingState =
        job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null;

      if (!pendingNode) {
        const visualIndex =
          (existingGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0) +
          (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0);
        const outputNodePosition = resolveGeneratedTextNodePlacement({
          descriptorOrderIndex: 0,
          fallbackVisualIndex: visualIndex,
          exactPendingNode: null,
          genericSmartPlaceholderNode: null,
          allowGenericSmartPlaceholder: false,
          modelAnchor: modelSpawnAnchor!,
        }).position;
        const outputNode = createGeneratedModelPlaceholderNode(
          modelNode!,
          job,
          sourceNodeId!,
          placeholderTarget,
          nextCanvasNodeZIndex(workingNodes),
          visualIndex,
          outputNodePosition
        );
        upsertWorkingNode(outputNode);
        insertedGeneratedTextCountByModelNodeId.set(
          sourceNodeId!,
          (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId!) || 0) + 1
        );
        continue;
      }

      if (pendingNodes.length > 1) {
        filterWorkingNodes((node) => node.id === pendingNode.id || !pendingNodes.some((candidate) => candidate.id === node.id));
      }

      if (pendingNode.processingState !== nextProcessingState) {
        upsertWorkingNode({
          ...pendingNode,
          processingState: nextProcessingState,
        });
      }
    }

    if (copilotJobSummaries.size > 0) {
      setCopilotMessages((prev) => applyCanvasCopilotSuccessSummaries(prev, copilotJobSummaries));

      if (copilotActiveJobId && copilotJobSummaries.has(copilotActiveJobId)) {
        setCopilotActiveJobId(null);
      }
    }

    if (!didChange && !didReceiptChange) {
      return;
    }

    const nextDoc = setCanvasGeneratedOutputReceiptKeys(
      {
        ...prev,
        workflow: {
          nodes: workingNodes,
        },
      },
      nextGeneratedOutputReceiptKeys
    );

    applyCanvasDocWithoutHistory(nextDoc, {
      selectedNodeIds: nextSelectedNodeIds.filter((nodeId) => nextDoc.workflow.nodes.some((node) => node.id === nodeId)),
    });
  }, [applyCanvasDocWithoutHistory, copilotActiveJobId, jobs]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (insertMenuRef.current && target && insertMenuRef.current.contains(target)) {
        return;
      }
      if (assetPickerRef.current && target && assetPickerRef.current.contains(target)) {
        return;
      }

      setInsertMenu(null);
      setAssetPicker(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInsertMenu(null);
        setAssetPicker(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!assetPicker) {
      setAssetPickerAssets([]);
      setAssetPickerSelectedIds([]);
      setAssetPickerQuery("");
      setAssetPickerError(null);
      return;
    }

    let canceled = false;
    setAssetPickerLoading(true);
    getAssetPointers(projectId, {
      origin: assetPicker.origin,
      query: assetPickerQuery,
    })
      .then((assets) => {
        if (canceled) {
          return;
        }
        setAssetPickerAssets(assets);
        setAssetPickerError(null);
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        setAssetPickerAssets([]);
        setAssetPickerError(error instanceof Error ? error.message : "Failed to load assets.");
      })
      .finally(() => {
        if (!canceled) {
          setAssetPickerLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [assetPicker, assetPickerQuery, projectId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      hasLoadedCanvasRef.current = false;
      pendingCanvasSaveRef.current = null;
    };
  }, []);

  const addModelNode = useCallback(
    (
      position?: { x: number; y: number },
      options?: {
        connectFromNodeId?: string;
        providerId?: WorkflowNode["providerId"];
        modelId?: string;
        centerOnPosition?: { x: number; y: number };
      }
    ) => {
      const chosenProvider =
        (options?.providerId && options?.modelId
          ? providers.find(
              (provider) =>
                provider.providerId === options.providerId && provider.modelId === options.modelId
            )
          : null) || getFallbackProviderModel(providers);

      const nodeId = uid();
      const didMutate = runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const outputType = resolveOutputType(undefined, getModelSupportedOutputs(chosenProvider));
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const zIndex = nextCanvasNodeZIndex(prev.workflow.nodes);
        const connectFromNode = options?.connectFromNodeId
          ? prev.workflow.nodes.find((candidate) => candidate.id === options.connectFromNodeId) || null
          : null;
        const node: WorkflowNode = {
          id: nodeId,
          label: `Node ${prev.workflow.nodes.length + 1}`,
          kind: "model",
          providerId: chosenProvider.providerId,
          modelId: chosenProvider.modelId,
          nodeType: nodeTypeFromOutput(outputType),
          outputType,
          prompt: "",
          settings: getModelDefaultSettings(chosenProvider),
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          sourceOutputIndex: null,
          processingState: null,
          promptSourceNodeId: connectFromNode?.kind === "text-note" ? connectFromNode.id : null,
          upstreamNodeIds:
            connectFromNode && connectFromNode.kind !== "text-note" ? [connectFromNode.id] : [],
          upstreamAssetIds:
            connectFromNode && connectFromNode.kind !== "text-note"
              ? buildAssetRefsFromNodes([connectFromNode.id], prev.workflow.nodes)
              : [],
          x: nextPosition.x,
          y: nextPosition.y,
          zIndex,
          displayMode: "preview",
          size: null,
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, node],
          },
        };

        return {
          canvasDoc: nextDoc,
          selectedNodeIds: [node.id],
          selectedConnection: null,
        };
      });
      if (didMutate && options?.centerOnPosition) {
        setPendingCenteredInsert({
          nodeId,
          anchor: options.centerOnPosition,
        });
      }
      setInsertMenu(null);
      if (didMutate) {
        setActiveFullNodeId(nodeId);
        setPinnedModelFullNodeId(nodeId);
      } else {
        setActiveFullNodeId(null);
        setPinnedModelFullNodeId(null);
      }
    },
    [providers, runUserCanvasMutation]
  );

  const addTextNote = useCallback(
    (
      position?: { x: number; y: number },
      options?: { connectToModelNodeId?: string; centerOnPosition?: { x: number; y: number } }
    ) => {
      const defaultProvider = getFallbackProviderModel(providers);

      const nodeId = uid();
      const didMutate = runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const zIndex = nextCanvasNodeZIndex(prev.workflow.nodes);
        const node: WorkflowNode = {
          id: nodeId,
          label: `Note ${prev.workflow.nodes.filter((item) => item.kind === "text-note").length + 1}`,
          kind: "text-note",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: "text-note",
          outputType: "text",
          prompt: "",
          settings: { source: "text-note" },
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          sourceOutputIndex: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: nextPosition.x,
          y: nextPosition.y,
          zIndex,
          displayMode: "preview",
          size: null,
        };

        const nextNodes = prev.workflow.nodes.map((candidate) => {
          if (candidate.id !== options?.connectToModelNodeId || candidate.kind !== "model") {
            return candidate;
          }

          return {
            ...candidate,
            promptSourceNodeId: node.id,
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...nextNodes, node],
          },
        };

        return {
          canvasDoc: nextDoc,
          selectedNodeIds: [node.id],
          selectedConnection: null,
        };
      });
      if (didMutate && options?.centerOnPosition) {
        setPendingCenteredInsert({
          nodeId,
          anchor: options.centerOnPosition,
        });
      }
      setInsertMenu(null);
      setActiveFullNodeId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const addListNode = useCallback(
    (
      position?: { x: number; y: number },
      options?: { connectToTemplateNodeId?: string; centerOnPosition?: { x: number; y: number } }
    ) => {
      const defaultProvider = getFallbackProviderModel(providers);

      const nodeId = uid();
      const didMutate = runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const zIndex = nextCanvasNodeZIndex(prev.workflow.nodes);
        const node: WorkflowNode = {
          id: nodeId,
          label: `List ${prev.workflow.nodes.filter((item) => item.kind === "list").length + 1}`,
          kind: "list",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: "list",
          outputType: "text",
          prompt: "",
          settings: createDefaultListNodeSettings(),
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          sourceOutputIndex: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: nextPosition.x,
          y: nextPosition.y,
          zIndex,
          displayMode: "preview",
          size: null,
        };

        const nextNodes = prev.workflow.nodes.map((candidate) => {
          if (candidate.id !== options?.connectToTemplateNodeId || candidate.kind !== "text-template") {
            return candidate;
          }

          return {
            ...candidate,
            upstreamNodeIds: [node.id],
            upstreamAssetIds: buildAssetRefsFromNodes([node.id], [...prev.workflow.nodes, node]),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...nextNodes, node],
          },
        };

        return {
          canvasDoc: nextDoc,
          selectedNodeIds: [node.id],
          selectedConnection: null,
        };
      });
      if (didMutate && options?.centerOnPosition) {
        setPendingCenteredInsert({
          nodeId,
          anchor: options.centerOnPosition,
        });
      }
      setInsertMenu(null);
      setActiveFullNodeId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const addTextTemplateNode = useCallback(
    (
      position?: { x: number; y: number },
      options?: { connectFromListNodeId?: string; centerOnPosition?: { x: number; y: number } }
    ) => {
      const defaultProvider = getFallbackProviderModel(providers);

      const nodeId = uid();
      const didMutate = runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const zIndex = nextCanvasNodeZIndex(prev.workflow.nodes);
        const connectFromNode =
          options?.connectFromListNodeId
            ? prev.workflow.nodes.find((candidate) => candidate.id === options.connectFromListNodeId && candidate.kind === "list") || null
            : null;
        const node: WorkflowNode = {
          id: nodeId,
          label: `Template ${prev.workflow.nodes.filter((item) => item.kind === "text-template").length + 1}`,
          kind: "text-template",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: "text-template",
          outputType: "text",
          prompt: "",
          settings: createTextTemplateNodeSettings(),
          sourceAssetId: null,
          sourceAssetMimeType: null,
          sourceJobId: null,
          sourceOutputIndex: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: connectFromNode ? [connectFromNode.id] : [],
          upstreamAssetIds: connectFromNode ? buildAssetRefsFromNodes([connectFromNode.id], prev.workflow.nodes) : [],
          x: nextPosition.x,
          y: nextPosition.y,
          zIndex,
          displayMode: "preview",
          size: null,
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, node],
          },
        };

        return {
          canvasDoc: nextDoc,
          selectedNodeIds: [node.id],
          selectedConnection: null,
        };
      });
      if (didMutate && options?.centerOnPosition) {
        setPendingCenteredInsert({
          nodeId,
          anchor: options.centerOnPosition,
        });
      }
      setInsertMenu(null);
      setActiveFullNodeId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const getCanvasViewportCenterAnchor = useCallback(
    (options?: { stagger?: boolean }) => {
      const offsetIndex = options?.stagger ? nativeMenuInsertCountRef.current++ : 0;
      const rect = canvasSurfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        const fallbackPosition = nextCanvasNodePosition(canvasDoc.workflow.nodes.length);
        return {
          clientX: 0,
          clientY: 0,
          worldX: fallbackPosition.x + (offsetIndex % 3) * 44,
          worldY: fallbackPosition.y + (Math.floor(offsetIndex / 3) % 3) * 36,
        };
      }

      return {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        worldX: Math.round(
          (rect.width / 2 - canvasDoc.canvasViewport.x) / canvasDoc.canvasViewport.zoom + (offsetIndex % 3) * 44
        ),
        worldY: Math.round(
          (rect.height / 2 - canvasDoc.canvasViewport.y) / canvasDoc.canvasViewport.zoom +
            (Math.floor(offsetIndex / 3) % 3) * 36
        ),
      };
    },
    [canvasDoc.canvasViewport, canvasDoc.workflow.nodes.length]
  );

  const getNativeMenuInsertPosition = useCallback(() => {
    const anchor = getCanvasViewportCenterAnchor({ stagger: true });
    return {
      x: anchor.worldX,
      y: anchor.worldY,
    };
  }, [getCanvasViewportCenterAnchor]);

  const openCanvasInsertMenu = useCallback(() => {
    commitPendingCoalescedHistory();
    const anchor = getCanvasViewportCenterAnchor();
    setTrackedSelectedConnection(null);
    setActiveFullNodeId(null);
    setAssetPicker(null);
    setInsertMenu({
      clientX: anchor.clientX,
      clientY: anchor.clientY,
      worldX: anchor.worldX,
      worldY: anchor.worldY,
      mode: "canvas",
    });
  }, [commitPendingCoalescedHistory, getCanvasViewportCenterAnchor, setTrackedSelectedConnection]);

  const handleInsertCatalogEntry = useCallback(
    (
      entryId: "model" | "text-note" | "list" | "text-template" | "asset-uploaded" | "asset-generated",
      menuState: CanvasInsertMenuState | null,
      position: { x: number; y: number },
      options?: { providerId?: WorkflowNode["providerId"]; modelId?: string }
    ) => {
      if (!menuState) {
        return;
      }

      if (entryId === "model") {
        addModelNode(getCenteredInsertPosition(position), {
          providerId: options?.providerId,
          modelId: options?.modelId,
          centerOnPosition: position,
        });
        return;
      }

      if (entryId === "text-note") {
        addTextNote(
          getCenteredInsertPosition(position),
          {
            connectToModelNodeId:
              menuState.mode === "model-input" && menuState.connectToNodeId ? menuState.connectToNodeId : undefined,
            centerOnPosition: position,
          }
        );
        return;
      }

      if (entryId === "list") {
        addListNode(
          getCenteredInsertPosition(position),
          {
            connectToTemplateNodeId:
              menuState.mode === "template-input" && menuState.connectToNodeId ? menuState.connectToNodeId : undefined,
            centerOnPosition: position,
          }
        );
        return;
      }

      if (entryId === "text-template") {
        addTextTemplateNode(getCenteredInsertPosition(position), {
          centerOnPosition: position,
        });
        return;
      }

      if (entryId === "asset-uploaded") {
        setInsertMenu(null);
        setAssetPicker({
          origin: "uploaded",
          worldX: position.x,
          worldY: position.y,
          connectToModelNodeId: menuState.mode === "model-input" ? menuState.connectToNodeId : undefined,
        });
        return;
      }

      setInsertMenu(null);
      setAssetPicker({
        origin: "generated",
        worldX: position.x,
        worldY: position.y,
        connectToModelNodeId: menuState.mode === "model-input" ? menuState.connectToNodeId : undefined,
      });
    },
    [addListNode, addModelNode, addTextNote, addTextTemplateNode]
  );

  const updateNode = useCallback(
    (
      nodeId: string,
      patch: Partial<WorkflowNode>,
      options?: {
        historyMode?: "immediate" | "coalesced";
        historyKey?: string;
      }
    ) => {
      runUserCanvasMutation(
        (currentState) => {
          const prev = currentState.canvasDoc;
          let didChange = false;
          const nextNodes = prev.workflow.nodes.map((node) => {
            if (node.id !== nodeId) {
              return node;
            }

            const nextNode = { ...node, ...patch };
            if (JSON.stringify(nextNode) === JSON.stringify(node)) {
              return node;
            }

            didChange = true;
            return nextNode;
          });

          if (!didChange) {
            return null;
          }

          return {
            canvasDoc: {
              ...prev,
              workflow: {
                nodes: nextNodes,
              },
            },
          };
        },
        options
      );
    },
    [runUserCanvasMutation]
  );

  const commitNodePositions = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        let didChange = false;
        const nextNodes = prev.workflow.nodes.map((node) => {
          const nextPosition = positions[node.id];
          if (!nextPosition) {
            return node;
          }

          if (node.x === nextPosition.x && node.y === nextPosition.y) {
            return node;
          }

          didChange = true;
          return {
            ...node,
            x: nextPosition.x,
            y: nextPosition.y,
          };
        });

        if (!didChange) {
          return null;
        }

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          },
        };
      });
    },
    [runUserCanvasMutation]
  );

  const canConnectNodePair = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      return canConnectCanvasNodes(nodesById[sourceNodeId], nodesById[targetNodeId]);
    },
    [nodesById]
  );

  const canConnectSelected = useMemo(() => {
    return selectedNodeIds.length === 2 && canConnectNodePair(selectedNodeIds[0], selectedNodeIds[1]);
  }, [canConnectNodePair, selectedNodeIds]);

  const canDuplicateSelected = selectedNodeIds.length === 1;

  const undoCanvasChange = useCallback(() => {
    commitPendingCoalescedHistory();
    const patch = historyStacksRef.current.undo.at(-1);
    if (!patch) {
      return;
    }

    const nextState = applyCanvasHistoryPatch(captureCanvasHistoryState(), patch, "undo");
    applyCanvasHistoryState(nextState);
    syncHistoryStacks({
      undo: historyStacksRef.current.undo.slice(0, -1),
      redo: [...historyStacksRef.current.redo, patch].slice(-CANVAS_HISTORY_LIMIT),
    });
    setActiveFullNodeId(null);
  }, [applyCanvasHistoryState, captureCanvasHistoryState, commitPendingCoalescedHistory, syncHistoryStacks]);

  const redoCanvasChange = useCallback(() => {
    commitPendingCoalescedHistory();
    const patch = historyStacksRef.current.redo.at(-1);
    if (!patch) {
      return;
    }

    const nextState = applyCanvasHistoryPatch(captureCanvasHistoryState(), patch, "redo");
    applyCanvasHistoryState(nextState);
    syncHistoryStacks({
      undo: [...historyStacksRef.current.undo, patch].slice(-CANVAS_HISTORY_LIMIT),
      redo: historyStacksRef.current.redo.slice(0, -1),
    });
    setActiveFullNodeId(null);
  }, [applyCanvasHistoryState, captureCanvasHistoryState, commitPendingCoalescedHistory, syncHistoryStacks]);

  const openPrimaryEditorForNode = useCallback(
    (nodeId: string, options?: { focusViewport?: boolean }) => {
      const node = nodesById[nodeId];
      if (!node) {
        return;
      }

      commitPendingCoalescedHistory();
      setTrackedSelectedNodeIds([nodeId]);
      setTrackedSelectedConnection(null);
      setInsertMenu(null);
      setAssetPicker(null);
      if (node.kind === "text-template") {
        setActiveFullNodeId(nodeId);
        setPinnedModelFullNodeId(null);
      } else if (node.kind === "model" && node.displayMode !== "resized") {
        setActiveFullNodeId(nodeId);
        setPinnedModelFullNodeId(nodeId);
      } else {
        setActiveFullNodeId(null);
        setPinnedModelFullNodeId(null);
      }
      if (options?.focusViewport) {
        setPendingViewportFocusNodeId(nodeId);
      }
    },
    [commitPendingCoalescedHistory, nodesById, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const enterNodeEditMode = useCallback(
    (nodeId: string, options?: { focusViewport?: boolean }) => {
      const node = nodesById[nodeId];
      if (!node) {
        return;
      }

      commitPendingCoalescedHistory();
      setTrackedSelectedNodeIds([nodeId]);
      setTrackedSelectedConnection(null);
      setInsertMenu(null);
      setAssetPicker(null);
      if (node.kind === "text-template") {
        setActiveFullNodeId(nodeId);
        setPinnedModelFullNodeId(null);
      } else if (node.kind === "model" && node.displayMode !== "resized") {
        setActiveFullNodeId(nodeId);
        setPinnedModelFullNodeId(nodeId);
      } else {
        setActiveFullNodeId(null);
        setPinnedModelFullNodeId(null);
      }
      if (options?.focusViewport) {
        setPendingViewportFocusNodeId(nodeId);
      }
    },
    [commitPendingCoalescedHistory, nodesById, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const openPrimaryEditorForSelection = useCallback(() => {
    if (selectedNodeIdsRef.current.length !== 1) {
      return;
    }
    openPrimaryEditorForNode(selectedNodeIdsRef.current[0]!);
  }, [openPrimaryEditorForNode]);

  const focusNodeViewport = useCallback(
    (nodeId: string) => {
      const node = nodesById[nodeId];
      if (!node) {
        return;
      }

      commitPendingCoalescedHistory();
      setTrackedSelectedNodeIds([nodeId]);
      setTrackedSelectedConnection(null);
      setInsertMenu(null);
      setAssetPicker(null);
      setPendingViewportFocusNodeId(nodeId);
    },
    [commitPendingCoalescedHistory, nodesById, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const focusAndOpenNode = useCallback(
    (nodeId: string) => {
      const node = nodesById[nodeId];
      if (!node) {
        return;
      }

      if (node.kind === "asset-source" && node.outputType === "image") {
        focusNodeViewport(nodeId);
        return;
      }

      if (node.kind === "text-template") {
        enterNodeEditMode(nodeId, { focusViewport: true });
        return;
      }

      if (node.displayMode === "resized") {
        focusNodeViewport(nodeId);
        return;
      }

      openPrimaryEditorForNode(nodeId, { focusViewport: true });
    },
    [enterNodeEditMode, focusNodeViewport, nodesById, openPrimaryEditorForNode]
  );

  const updateSelectedModelParameter = useCallback(
    (parameterKey: string, value: string | number | null) => {
      if (!selectedNode || !selectedNodeIsModel) {
        return;
      }

      const nextSettings = {
        ...selectedNode.settings,
      };

      if (value === null || value === "") {
        delete nextSettings[parameterKey];
      } else {
        nextSettings[parameterKey] = value;
      }

      const effectiveSettings = resolveModelSettings(selectedModel, nextSettings, selectedNodeExecutionMode);
      updateNode(
        selectedNode.id,
        {
          settings: effectiveSettings,
        },
        {
          historyMode: typeof value === "string" ? "coalesced" : "immediate",
          historyKey: `node:${selectedNode.id}:parameter:${parameterKey}`,
        }
      );
    },
    [selectedModel, selectedNode, selectedNodeExecutionMode, selectedNodeIsModel, updateNode]
  );

  const handleSelectedNodeLabelChange = useCallback(
    (label: string) => {
      if (!selectedNode) {
        return;
      }
      updateNode(
        selectedNode.id,
        { label },
        {
          historyMode: "coalesced",
          historyKey: `node:${selectedNode.id}:label`,
        }
      );
    },
    [selectedNode, updateNode]
  );

  const handleSelectedNodePromptChange = useCallback(
    (prompt: string) => {
      if (!selectedNode) {
        return;
      }
      updateNode(
        selectedNode.id,
        { prompt },
        {
          historyMode: "coalesced",
          historyKey: `node:${selectedNode.id}:prompt`,
        }
      );
    },
    [selectedNode, updateNode]
  );

  const handleSelectedNodeModelVariantChange = useCallback(
    (variantId: string) => {
      if (!selectedNode || !selectedNodeIsModel) {
        return;
      }

      const variant = getModelCatalogVariantById(providers, variantId);
      if (!variant) {
        return;
      }

      const model = providers.find(
        (providerModel) =>
          providerModel.providerId === variant.providerId && providerModel.modelId === variant.modelId
      );
      const supportedOutputs = getModelSupportedOutputs(model);
      const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);
      const nextUpstreamNodeIds = isRunnableTextModel(model?.providerId, model?.modelId)
        ? []
        : selectedNode.upstreamNodeIds;
      const nextExecutionMode = getExecutionModeForModel(model, nextUpstreamNodeIds);

      updateNode(
        selectedNode.id,
        {
          providerId: variant.providerId,
          modelId: variant.modelId,
          outputType,
          nodeType: nodeTypeFromOutput(outputType),
          upstreamNodeIds: nextUpstreamNodeIds,
          upstreamAssetIds: isRunnableTextModel(model?.providerId, model?.modelId)
            ? []
            : buildAssetRefsFromNodes(nextUpstreamNodeIds, canvasDoc.workflow.nodes),
          settings: resolveModelSettings(model, selectedNode.settings, nextExecutionMode),
        },
        {
          historyMode: "immediate",
        }
      );
    },
    [canvasDoc.workflow.nodes, getExecutionModeForModel, providers, selectedNode, selectedNodeIsModel, updateNode]
  );

  const handleClearSelectedInputs = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    if (selectedNodeIsModel) {
      updateNode(
        selectedNode.id,
        {
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          promptSourceNodeId: null,
        },
        {
          historyMode: "immediate",
        }
      );
      return;
    }

    if (selectedNodeIsTextTemplate) {
      updateNode(
        selectedNode.id,
        {
          upstreamNodeIds: [],
          upstreamAssetIds: [],
        },
        {
          historyMode: "immediate",
        }
      );
    }
  }, [selectedNode, selectedNodeIsModel, selectedNodeIsTextTemplate, updateNode]);

  const uploadFilesToCanvas = useCallback(
    async (files: File[], position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      if (files.length === 0) {
        return;
      }

      try {
        const uploaded = await Promise.all(
          files.map(async (file) => ({
            file,
            asset: await uploadProjectAsset(projectId, file),
          }))
        );

        const defaultProvider = getFallbackProviderModel(providers);
        let nextCanvasDocument: CanvasDocument | null = null;
        runUserCanvasMutation((currentState) => {
          const prev = currentState.canvasDoc;
          const result = insertImportedAssetsIntoCanvasDocument(
            prev,
            uploaded.map(({ asset }) => asset),
            {
              defaultProvider,
              position,
              connectToModelNodeId: options?.connectToModelNodeId,
              assetLabels: uploaded.map(({ file }) => file.name),
            }
          );
          nextCanvasDocument = result.canvasDocument;
          const lastSourceNodeId = result.insertedNodeIds[result.insertedNodeIds.length - 1];
          return {
            canvasDoc: result.canvasDocument,
            selectedNodeIds: lastSourceNodeId ? [lastSourceNodeId] : [],
            selectedConnection: null,
          };
        }, { persist: false });
        if (nextCanvasDocument) {
          await persistCanvasImmediately(nextCanvasDocument);
        }
        setInsertMenu(null);
        setActiveFullNodeId(null);
      } catch (error) {
        console.error(error);
      } finally {
        pendingUploadAnchorRef.current = null;
      }
    },
    [persistCanvasImmediately, projectId, providers, runUserCanvasMutation]
  );

  const addImportedAssetsToCanvas = useCallback(
    async (
      imported: Asset[],
      position?: { x: number; y: number },
      options?: { connectToModelNodeId?: string },
      assetLabels?: string[]
    ) => {
      if (imported.length === 0) {
        return;
      }

      const defaultProvider = getFallbackProviderModel(providers);
      let nextCanvasDocument: CanvasDocument | null = null;
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const result = insertImportedAssetsIntoCanvasDocument(
          prev,
          imported,
          {
            defaultProvider,
            position,
            connectToModelNodeId: options?.connectToModelNodeId,
            assetLabels,
          }
        );
        nextCanvasDocument = result.canvasDocument;
        const lastSourceNodeId = result.insertedNodeIds[result.insertedNodeIds.length - 1];
        return {
          canvasDoc: result.canvasDocument,
          selectedNodeIds: lastSourceNodeId ? [lastSourceNodeId] : [],
          selectedConnection: null,
        };
      }, { persist: false });
      if (nextCanvasDocument) {
        await persistCanvasImmediately(nextCanvasDocument);
      }
      setInsertMenu(null);
      setActiveFullNodeId(null);
    },
    [persistCanvasImmediately, providers, runUserCanvasMutation]
  );

  const spawnAssetPointerNodes = useCallback(
    (assets: Asset[], position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      if (assets.length === 0) {
        return;
      }

      const defaultProvider = getFallbackProviderModel(providers);
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const baseX = position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
        const baseY = position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);
        const baseZIndex = nextCanvasNodeZIndex(prev.workflow.nodes);

        const sourceNodes = assets.map((asset, index) => {
          if (!asset.jobId && asset.origin !== "generated") {
            return createUploadedAssetSourceNode(asset, index, {
              defaultProvider,
              position: {
                x: baseX + index * 34,
                y: baseY + index * 26,
              },
              zIndex: baseZIndex + index,
              label: getAssetPointerNodeLabel(asset, index),
            });
          }

          const outputType = outputTypeFromAssetType(asset.type);
          const providerId: WorkflowNode["providerId"] =
            asset.job?.providerId === "openai" || asset.job?.providerId === "google-gemini" || asset.job?.providerId === "topaz"
              ? asset.job.providerId
              : defaultProvider.providerId;

          return {
            id: uid(),
            label: getAssetPointerNodeLabel(asset, index),
            kind: "asset-source" as const,
            providerId,
            modelId: asset.job?.modelId || defaultProvider.modelId,
            nodeType: "transform" as const,
            outputType,
            prompt: "",
            settings: {
              source: "generated",
              sourceJobId: asset.jobId || null,
              outputIndex: typeof asset.outputIndex === "number" ? asset.outputIndex : null,
            },
            sourceAssetId: asset.id,
            sourceAssetMimeType: asset.mimeType,
            sourceJobId: asset.jobId || null,
            sourceOutputIndex: typeof asset.outputIndex === "number" ? asset.outputIndex : null,
            processingState: null,
            promptSourceNodeId: null,
            upstreamNodeIds: [],
            upstreamAssetIds: [],
            x: Math.round(baseX + index * 34),
            y: Math.round(baseY + index * 26),
            zIndex: baseZIndex + index,
            displayMode: "preview" as const,
            size: null,
          };
        });

        const sourceNodeIds = sourceNodes.map((node) => node.id);
        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== options?.connectToModelNodeId || node.kind !== "model") {
            return node;
          }

          if (isRunnableTextModel(node.providerId, node.modelId)) {
            return node;
          }

          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, ...sourceNodeIds])];
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, [...prev.workflow.nodes, ...sourceNodes]),
          };
        });

        const lastSourceNode = sourceNodes[sourceNodes.length - 1];
        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: [...nextNodes, ...sourceNodes],
            },
          },
          selectedNodeIds: lastSourceNode ? [lastSourceNode.id] : [],
          selectedConnection: null,
        };
      });
      setAssetPicker(null);
      setActiveFullNodeId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const handleCanvasInsertRequest = useCallback(
    (request: CanvasInsertRequest) => {
      commitPendingCoalescedHistory();
      setTrackedSelectedConnection(null);
      setActiveFullNodeId(null);

      if (request.connectionNodeId && request.connectionPort === "output") {
        const sourceNode = nodesById[request.connectionNodeId];
        if (sourceNode && (sourceNode.kind === "text-note" || sourceNode.kind === "asset-source")) {
          addModelNode({ x: request.x, y: request.y }, { connectFromNodeId: sourceNode.id });
          return;
        }

        if (sourceNode?.kind === "list") {
          addTextTemplateNode({ x: request.x, y: request.y }, { connectFromListNodeId: sourceNode.id });
          return;
        }
      }

      if (request.connectionNodeId && request.connectionPort === "input") {
        const targetNode = nodesById[request.connectionNodeId];
        if (targetNode?.kind === "model") {
          setInsertMenu({
            clientX: request.clientX,
            clientY: request.clientY,
            worldX: request.x,
            worldY: request.y,
            mode: "model-input",
            connectToNodeId: targetNode.id,
          });
          return;
        }

        if (targetNode?.kind === "text-template") {
          setInsertMenu({
            clientX: request.clientX,
            clientY: request.clientY,
            worldX: request.x,
            worldY: request.y,
            mode: "template-input",
            connectToNodeId: targetNode.id,
          });
          return;
        }
      }

      setInsertMenu({
        clientX: request.clientX,
        clientY: request.clientY,
        worldX: request.x,
        worldY: request.y,
        mode: "canvas",
      });
    },
    [addModelNode, addTextTemplateNode, commitPendingCoalescedHistory, nodesById, setTrackedSelectedConnection]
  );

  const removeConnection = useCallback(
    (connection: CanvasConnection | null) => {
      if (!connection) {
        return;
      }

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== connection.targetNodeId) {
            return node;
          }

          if (connection.kind === "prompt") {
            return {
              ...node,
              promptSourceNodeId: node.promptSourceNodeId === connection.sourceNodeId ? null : node.promptSourceNodeId,
            };
          }

          const upstreamNodeIds = node.upstreamNodeIds.filter((nodeId) => nodeId !== connection.sourceNodeId);
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, prev.workflow.nodes),
          };
        });

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          },
          selectedConnection: null,
        };
      });
    },
    [runUserCanvasMutation]
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const sourceNode = prev.workflow.nodes.find((node) => node.id === nodeId);
        if (!sourceNode) {
          return null;
        }

        const duplicateBase =
          sourceNode.kind === "model"
            ? {
                ...sourceNode,
              }
            : sourceNode.kind === "text-template"
              ? {
                  ...sourceNode,
                  settings: getGeneratedModelNodeSource(sourceNode.settings)
                    ? createTextTemplateNodeSettings()
                    : getTextTemplateNodeSettings(sourceNode.settings),
                  sourceJobId: null,
                  sourceOutputIndex: null,
                  processingState: null,
                  upstreamNodeIds: [],
                  upstreamAssetIds: [],
                }
              : sourceNode.kind === "list"
                ? {
                    ...sourceNode,
                    settings: {
                      source: "list" as const,
                      columns: getListNodeSettings(sourceNode.settings).columns,
                      rows: getListNodeSettings(sourceNode.settings).rows,
                    },
                    sourceJobId: null,
                    sourceOutputIndex: null,
                    processingState: null,
                    upstreamNodeIds: [],
                    upstreamAssetIds: [],
                  }
                : sourceNode.kind === "text-note"
                  ? {
                      ...sourceNode,
                      settings: isGeneratedTextNoteNode(sourceNode) ? createTextNoteSettings() : sourceNode.settings,
                      promptSourceNodeId: null,
                      upstreamNodeIds: [],
                      upstreamAssetIds: [],
                      sourceJobId: null,
                      sourceOutputIndex: null,
                      processingState: null,
                    }
                  : {
                      ...sourceNode,
                      upstreamNodeIds: [],
                      upstreamAssetIds: [],
                      processingState: null,
                      settings: {
                        ...sourceNode.settings,
                        sourceModelNodeId: null,
                      },
                    };

        const duplicate: WorkflowNode = {
          ...duplicateBase,
          id: uid(),
          label: sourceNode.label.endsWith(" Copy") ? sourceNode.label : `${sourceNode.label} Copy`,
          x: Math.round(sourceNode.x + 44),
          y: Math.round(sourceNode.y + 36),
          zIndex: nextCanvasNodeZIndex(prev.workflow.nodes),
        };

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: [...prev.workflow.nodes, duplicate],
            },
          },
          selectedNodeIds: [duplicate.id],
          selectedConnection: null,
        };
      });
    },
    [runUserCanvasMutation]
  );

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (!canConnectNodePair(sourceNodeId, targetNodeId)) {
        return;
      }

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const result = applyCanvasNodeConnection(prev.workflow.nodes, sourceNodeId, targetNodeId);
        if (!result.applied) {
          return null;
        }

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: result.nodes,
            },
          },
        };
      });
    },
    [canConnectNodePair, runUserCanvasMutation]
  );

  const removeNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) {
        return;
      }
      const nodeIdSet = new Set(nodeIds);

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const remainingNodes = prev.workflow.nodes.filter((node) => !nodeIdSet.has(node.id));
        const nextNodes = remainingNodes.map((node) => {
          const upstreamNodeIds = node.upstreamNodeIds.filter((upstreamNodeId) => !nodeIdSet.has(upstreamNodeId));
          return {
            ...node,
            promptSourceNodeId: node.promptSourceNodeId && nodeIdSet.has(node.promptSourceNodeId) ? null : node.promptSourceNodeId,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, remainingNodes),
          };
        });

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          },
          selectedNodeIds: currentState.selectedNodeIds.filter((nodeId) => !nodeIdSet.has(nodeId)),
          selectedConnection:
            currentState.selectedConnection &&
            (nodeIdSet.has(currentState.selectedConnection.sourceNodeId) ||
              nodeIdSet.has(currentState.selectedConnection.targetNodeId))
              ? null
              : currentState.selectedConnection,
        };
      });
    },
    [runUserCanvasMutation]
  );

  const connectSelectedNodes = useCallback(() => {
    if (!canConnectSelected) {
      return;
    }

    const [sourceNodeId, targetNodeId] = selectedNodeIdsRef.current;
    if (!sourceNodeId || !targetNodeId) {
      return;
    }

    connectNodes(sourceNodeId, targetNodeId);
  }, [canConnectSelected, connectNodes]);

  useEffect(() => {
    return subscribeToCanvasMenuCommand((command) => {
      if (isLoading) {
        return;
      }

      if (command.type === "canvas.open-insert-menu") {
        openCanvasInsertMenu();
        return;
      }

      if (command.type === "canvas.connect-selected") {
        connectSelectedNodes();
        return;
      }

      if (command.type === "canvas.duplicate-selected") {
        if (selectedNodeIdsRef.current.length === 1) {
          duplicateNode(selectedNodeIdsRef.current[0]!);
        }
        return;
      }

      if (command.type === "canvas.delete-selection") {
        if (selectedConnectionRef.current) {
          removeConnection(selectedConnectionRef.current);
          return;
        }

        removeNodes(selectedNodeIdsRef.current);
        return;
      }

      if (command.type === "canvas.open-primary-editor") {
        openPrimaryEditorForSelection();
        return;
      }

      if (command.type === "canvas.undo") {
        undoCanvasChange();
        return;
      }

      if (command.type === "canvas.redo") {
        redoCanvasChange();
        return;
      }

      const position = getNativeMenuInsertPosition();
      if (command.nodeType === "model") {
        addModelNode(position, {
          providerId: command.providerId,
          modelId: command.modelId,
        });
        return;
      }

      if (command.nodeType === "text-note") {
        addTextNote(position);
        return;
      }

      if (command.nodeType === "list") {
        addListNode(position);
        return;
      }

      if (command.nodeType === "text-template") {
        addTextTemplateNode(position);
        return;
      }

      setAssetPicker({
        origin: command.nodeType === "asset-generated" ? "generated" : "uploaded",
        worldX: position.x,
        worldY: position.y,
      });
    });
  }, [
    addListNode,
    addModelNode,
    addTextNote,
    addTextTemplateNode,
    connectSelectedNodes,
    duplicateNode,
    getNativeMenuInsertPosition,
    isLoading,
    openCanvasInsertMenu,
    openPrimaryEditorForSelection,
    redoCanvasChange,
    removeConnection,
    removeNodes,
    undoCanvasChange,
  ]);

  useHotkey("Mod+Z", () => {
    undoCanvasChange();
  }, { enabled: historyStacks.undo.length > 0, ignoreInputs: true });

  useHotkey("Mod+Shift+Z", () => {
    redoCanvasChange();
  }, { enabled: historyStacks.redo.length > 0, ignoreInputs: true });

  useHotkey("Mod+D", () => {
    if (selectedNodeIds.length === 1) {
      duplicateNode(selectedNodeIds[0]!);
    }
  }, { enabled: selectedNodeIds.length === 1, ignoreInputs: true });

  useHotkey("A", () => {
    openCanvasInsertMenu();
  }, { enabled: !isLoading, ignoreInputs: true });

  useHotkey("C", () => {
    connectSelectedNodes();
  }, { enabled: selectedNodeIds.length === 2, ignoreInputs: true });

  useHotkey("Enter", () => {
    openPrimaryEditorForSelection();
  }, { enabled: selectedNodeIds.length === 1, ignoreInputs: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      if (selectedNodeIdsRef.current.length !== 1) {
        return;
      }

      event.preventDefault();
      openPrimaryEditorForSelection();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openPrimaryEditorForSelection]);

  useHotkey("Delete", () => {
    if (selectedConnection) {
      removeConnection(selectedConnection);
      return;
    }

    if (selectedNodeIds.length > 0) {
      removeNodes(selectedNodeIds);
    }
  }, { enabled: Boolean(selectedConnection) || selectedNodeIds.length > 0, ignoreInputs: true });

  useHotkey("Backspace", () => {
    if (selectedConnection) {
      removeConnection(selectedConnection);
      return;
    }

    if (selectedNodeIds.length > 0) {
      removeNodes(selectedNodeIds);
    }
  }, { enabled: Boolean(selectedConnection) || selectedNodeIds.length > 0, ignoreInputs: true });

  const updateViewport = useCallback(
    (
      nextViewport: CanvasDocument["canvasViewport"],
      options?: {
        persist?: boolean;
      }
    ) => {
      applyCanvasDocWithoutHistory(
        {
          ...canvasDocRef.current,
          canvasViewport: nextViewport,
        },
        {
          persist: options?.persist,
        }
      );
    },
    [activeFullNodeId, applyCanvasDocWithoutHistory]
  );

  const animateViewportTo = useCallback(
    (targetViewport: CanvasDocument["canvasViewport"]) => {
      cancelViewportFocusAnimation();

      const startViewport = canvasDocRef.current.canvasViewport;
      const deltaX = targetViewport.x - startViewport.x;
      const deltaY = targetViewport.y - startViewport.y;
      const deltaZoom = targetViewport.zoom - startViewport.zoom;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5 && Math.abs(deltaZoom) < 0.0015) {
        updateViewport(targetViewport);
        return;
      }

      const startTime = performance.now();
      const step = (timestamp: number) => {
        const progress = Math.min(1, (timestamp - startTime) / NODE_FOCUS_ANIMATION_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextViewport = {
          x: startViewport.x + deltaX * eased,
          y: startViewport.y + deltaY * eased,
          zoom: startViewport.zoom + deltaZoom * eased,
        };

        updateViewport(nextViewport, { persist: false });

        if (progress >= 1) {
          viewportFocusAnimationFrameRef.current = null;
          updateViewport(targetViewport);
          return;
        }

        viewportFocusAnimationFrameRef.current = window.requestAnimationFrame(step);
      };

      viewportFocusAnimationFrameRef.current = window.requestAnimationFrame(step);
    },
    [cancelViewportFocusAnimation, updateViewport]
  );

  useEffect(() => {
    if (!pendingCenteredInsert) {
      return;
    }

    const targetNode = canvasDoc.workflow.nodes.find((node) => node.id === pendingCenteredInsert.nodeId);
    const surfaceElement = canvasSurfaceRef.current;
    if (!targetNode || !surfaceElement) {
      return;
    }

    const nodeElement = surfaceElement.querySelector<HTMLElement>(`[data-node-id="${pendingCenteredInsert.nodeId}"]`);
    if (!nodeElement || nodeElement.offsetWidth === 0 || nodeElement.offsetHeight === 0) {
      return;
    }

    const nextPosition = centerCanvasInsertPosition(pendingCenteredInsert.anchor, {
      width: nodeElement.offsetWidth,
      height: nodeElement.offsetHeight,
    });

    if (targetNode.x === nextPosition.x && targetNode.y === nextPosition.y) {
      setPendingCenteredInsert(null);
      return;
    }

    runUserCanvasMutation(
      (currentState) => {
        const prev = currentState.canvasDoc;
        let didChange = false;
        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== pendingCenteredInsert.nodeId) {
            return node;
          }

          if (node.x === nextPosition.x && node.y === nextPosition.y) {
            return node;
          }

          didChange = true;
          return {
            ...node,
            x: nextPosition.x,
            y: nextPosition.y,
          };
        });

        if (!didChange) {
          return null;
        }

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          },
        };
      },
      { persist: true }
    );
    setPendingCenteredInsert(null);
  }, [canvasDoc.workflow.nodes, pendingCenteredInsert, runUserCanvasMutation]);

  useEffect(() => {
    if (!pendingViewportFocusNodeId) {
      return;
    }

    const surfaceElement = canvasSurfaceRef.current;
    if (!surfaceElement) {
      return;
    }

    const targetNode = canvasNodes.find((node) => node.id === pendingViewportFocusNodeId);
    if (!targetNode) {
      setPendingViewportFocusNodeId(null);
      return;
    }

    cancelViewportFocusAnimation();

    const scheduleSetupFrame = (callback: FrameRequestCallback) => {
      let frameId = 0;
      frameId = window.requestAnimationFrame((timestamp) => {
        viewportFocusSetupFrameIdsRef.current = viewportFocusSetupFrameIdsRef.current.filter((candidate) => candidate !== frameId);
        callback(timestamp);
      });
      viewportFocusSetupFrameIdsRef.current.push(frameId);
    };

    const finalizeViewportFocus = () => {
      const latestTargetNode = canvasNodes.find((node) => node.id === pendingViewportFocusNodeId);
      if (!latestTargetNode) {
        setPendingViewportFocusNodeId(null);
        return;
      }

      const bounds = surfaceElement.getBoundingClientRect();
      if (bounds.width < 160 || bounds.height < 120) {
        setPendingViewportFocusNodeId(null);
        return;
      }

      const latestTargetElement = surfaceElement.querySelector<HTMLElement>(`[data-node-id="${latestTargetNode.id}"]`);
      const focusWidth = latestTargetElement?.offsetWidth || latestTargetNode.resolvedSize.width;
      const focusHeight = latestTargetElement?.offsetHeight || latestTargetNode.resolvedSize.height;

      const availableWidth = Math.max(220, bounds.width - NODE_FOCUS_ZOOM_PADDING_X * 2);
      const availableHeight = Math.max(180, bounds.height - NODE_FOCUS_ZOOM_PADDING_Y * 2);
      const fitZoom = Math.min(
        availableWidth / focusWidth,
        availableHeight / focusHeight
      );
      const zoom = Math.min(NODE_FOCUS_MAX_ZOOM, Math.max(NODE_FOCUS_MIN_ZOOM, fitZoom));
      const x = bounds.width / 2 - (latestTargetNode.x + focusWidth / 2) * zoom;
      const y = bounds.height / 2 - (latestTargetNode.y + focusHeight / 2) * zoom;

      animateViewportTo({ x, y, zoom });
      setPendingViewportFocusNodeId((current) => (current === latestTargetNode.id ? null : current));
    };

    let previousWidth = -1;
    let previousHeight = -1;
    let stableFrames = 0;
    let sampleCount = 0;

    const waitForNodeLayoutToSettle = () => {
      const nodeElement = surfaceElement.querySelector<HTMLElement>(`[data-node-id="${pendingViewportFocusNodeId}"]`);
      if (!nodeElement) {
        finalizeViewportFocus();
        return;
      }

      const rect = nodeElement.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;
      if (hasSize && Math.abs(rect.width - previousWidth) < 0.5 && Math.abs(rect.height - previousHeight) < 0.5) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      previousWidth = rect.width;
      previousHeight = rect.height;
      sampleCount += 1;

      if ((hasSize && stableFrames >= NODE_FOCUS_SETTLE_STABLE_FRAMES) || sampleCount >= NODE_FOCUS_SETTLE_MAX_FRAMES) {
        finalizeViewportFocus();
        return;
      }

      scheduleSetupFrame(() => {
        waitForNodeLayoutToSettle();
      });
    };

    scheduleSetupFrame(() => {
      waitForNodeLayoutToSettle();
    });

    return () => {
      clearViewportFocusSetupFrames();
    };
  }, [
    animateViewportTo,
    cancelViewportFocusAnimation,
    canvasNodes,
    clearViewportFocusSetupFrames,
    pendingViewportFocusNodeId,
  ]);

  useEffect(() => {
    return () => {
      cancelViewportFocusAnimation();
    };
  }, [cancelViewportFocusAnimation]);

  const handleViewportInteractionStart = useCallback(() => {
    cancelViewportFocusAnimation({ clearPending: true });
  }, [cancelViewportFocusAnimation]);

  const insertGeneratedOutputPlaceholder = useCallback(
    (job: Job, sourceNodeId: string, outputCount: number) => {
      const prev = canvasDocRef.current;
      if (
        prev.workflow.nodes.filter(
          (node) =>
            getNodeSourceJobId(node) === job.id &&
            (typeof node.settings.sourceModelNodeId === "string" || node.upstreamNodeIds.includes(sourceNodeId))
        ).length >= outputCount
      ) {
        return;
      }

      const modelNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId && node.kind === "model");
      if (!modelNode) {
        return;
      }
      const modelSpawnAnchor = getGeneratedModelSpawnAnchor({
        modelNode,
        activeNodeId: selectedNodeIdsRef.current.length === 1 ? selectedNodeIdsRef.current[0]! : null,
        fullNodeId: effectiveFullNodeId,
      });

      const generatedCount = prev.workflow.nodes.filter(
        (node) =>
          isGeneratedAssetNode(node) &&
          (node.settings.sourceModelNodeId === sourceNodeId || node.upstreamNodeIds.includes(sourceNodeId))
      ).length;

      const outputNodes: WorkflowNode[] = Array.from({ length: outputCount }, (_, outputOffset) => {
        const outputIndex = outputOffset;
        const visualIndex = generatedCount + outputOffset;
        return createGeneratedOutputNode(
          modelNode,
          job,
          sourceNodeId,
          nextCanvasNodeZIndex(prev.workflow.nodes) + outputOffset,
          outputIndex,
          visualIndex,
          buildGeneratedImageOutputPosition(modelSpawnAnchor, visualIndex)
        );
      });

      applyCanvasDocWithoutHistory({
        ...prev,
        workflow: {
          nodes: [...prev.workflow.nodes, ...outputNodes],
        },
      });
    },
    [applyCanvasDocWithoutHistory]
  );

  const insertGeneratedTextOutputPlaceholder = useCallback(
    (job: Job, sourceNodeId: string, target: "note" | "list" | "template") => {
      const prev = canvasDocRef.current;
      if (
        prev.workflow.nodes.filter(
          (node) => getNodeSourceJobId(node) === job.id && Boolean(getGeneratedModelNodeSource(node.settings))
        ).length >= 1
      ) {
        return;
      }

      const modelNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId && node.kind === "model");
      if (!modelNode) {
        return;
      }
      const visualIndex = getGeneratedModelNodeCount(prev.workflow.nodes, sourceNodeId);
      const outputNodePosition = resolveGeneratedTextNodePlacement({
        descriptorOrderIndex: 0,
        fallbackVisualIndex: visualIndex,
        exactPendingNode: null,
        genericSmartPlaceholderNode: null,
        allowGenericSmartPlaceholder: false,
        modelAnchor: getGeneratedModelSpawnAnchor({
          modelNode,
          activeNodeId: selectedNodeIdsRef.current.length === 1 ? selectedNodeIdsRef.current[0]! : null,
          fullNodeId: effectiveFullNodeId,
        }),
      }).position;

      applyCanvasDocWithoutHistory({
        ...prev,
        workflow: {
          nodes: [
            ...prev.workflow.nodes,
            createGeneratedModelPlaceholderNode(
              modelNode,
              job,
              sourceNodeId,
              target,
              nextCanvasNodeZIndex(prev.workflow.nodes),
              visualIndex,
              outputNodePosition
            ),
          ],
        },
      });
    },
    [applyCanvasDocWithoutHistory, effectiveFullNodeId]
  );

  const updateSelectedListSettings = useCallback(
    (nextSettings: ListNodeSettings, options?: { historyMode?: "immediate" | "coalesced"; historyKey?: string }) => {
      if (!selectedNode || !selectedNodeIsList) {
        return;
      }

      updateNode(
        selectedNode.id,
        {
          settings: nextSettings,
        },
        options
      );
    },
    [selectedNode, selectedNodeIsList, updateNode]
  );

  const updateSelectedListColumnLabel = useCallback(
    (columnId: string, label: string) => {
      if (!selectedListSettings || !selectedNode) {
        return;
      }

      updateSelectedListSettings(
        {
          ...selectedListSettings,
          columns: selectedListSettings.columns.map((column) => (column.id === columnId ? { ...column, label } : column)),
        },
        {
          historyMode: "coalesced",
          historyKey: `node:${selectedNode.id}:list-column:${columnId}`,
        }
      );
    },
    [selectedListSettings, selectedNode, updateSelectedListSettings]
  );

  const updateSelectedListCell = useCallback(
    (rowId: string, columnId: string, value: string) => {
      if (!selectedListSettings || !selectedNode) {
        return;
      }

      updateSelectedListSettings(
        {
          ...selectedListSettings,
          rows: selectedListSettings.rows.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  values: {
                    ...row.values,
                    [columnId]: value,
                  },
                }
              : row
          ),
        },
        {
          historyMode: "coalesced",
          historyKey: `node:${selectedNode.id}:list-cell:${rowId}:${columnId}`,
        }
      );
    },
    [selectedListSettings, selectedNode, updateSelectedListSettings]
  );

  const addSelectedListColumn = useCallback(() => {
    if (!selectedListSettings) {
      return;
    }

    const nextColumn = {
      id: uid(),
      label: `Column ${selectedListSettings.columns.length + 1}`,
    };

    updateSelectedListSettings(
      {
        ...selectedListSettings,
        columns: [...selectedListSettings.columns, nextColumn],
        rows: selectedListSettings.rows.map((row) => ({
          ...row,
          values: {
            ...row.values,
            [nextColumn.id]: "",
          },
        })),
      },
      {
        historyMode: "immediate",
      }
    );
  }, [selectedListSettings, updateSelectedListSettings]);

  const removeSelectedListColumn = useCallback(
    (columnId: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings(
        {
          ...selectedListSettings,
          columns: selectedListSettings.columns.filter((column) => column.id !== columnId),
          rows: selectedListSettings.rows.map((row) => {
            const nextValues = { ...row.values };
            delete nextValues[columnId];
            return {
              ...row,
              values: nextValues,
            };
          }),
        },
        {
          historyMode: "immediate",
        }
      );
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const addSelectedListRow = useCallback((initialValues?: Record<string, string>) => {
    if (!selectedListSettings) {
      return null;
    }

    const rowId = uid();

    updateSelectedListSettings(
      {
        ...selectedListSettings,
        rows: [
          ...selectedListSettings.rows,
          {
            id: rowId,
            values: selectedListSettings.columns.reduce<Record<string, string>>((acc, column) => {
              acc[column.id] = String(initialValues?.[column.id] ?? "");
              return acc;
            }, {}),
          },
        ],
      },
      {
        historyMode: "immediate",
      }
    );
    return rowId;
  }, [selectedListSettings, updateSelectedListSettings]);

  const removeSelectedListRow = useCallback(
    (rowId: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings(
        {
          ...selectedListSettings,
          rows: selectedListSettings.rows.filter((row) => row.id !== rowId),
        },
        {
          historyMode: "immediate",
        }
      );
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const generateTextTemplateOutputs = useCallback(
    (nodeId: string) => {
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const templateNode = prev.workflow.nodes.find((node) => node.id === nodeId && node.kind === "text-template");
        if (!templateNode) {
          return null;
        }

        const listNode = templateNode.upstreamNodeIds
          .map((upstreamNodeId) => prev.workflow.nodes.find((candidate) => candidate.id === upstreamNodeId) || null)
          .find((candidate) => candidate?.kind === "list") || null;
        const preview = buildTextTemplatePreview(
          templateNode.prompt,
          listNode ? getListNodeSettings(listNode.settings) : null
        );

        if (!listNode || preview.disabledReason) {
          return null;
        }

        const existingGeneratedCount = getGeneratedTextOutputCount(prev.workflow.nodes, templateNode.id);
        const batchId = uid();
        const outputNodes = preview.rows.map((row, outputOffset) =>
          createGeneratedTextOutputNode(
            templateNode,
            listNode.id,
            batchId,
            row,
            nextCanvasNodeZIndex(prev.workflow.nodes) + outputOffset,
            existingGeneratedCount + outputOffset,
            outputOffset
          )
        );

        if (outputNodes.length === 0) {
          return null;
        }

        return {
          canvasDoc: {
            ...prev,
            workflow: {
              nodes: [...prev.workflow.nodes, ...outputNodes],
            },
          },
          selectedNodeIds: [outputNodes[outputNodes.length - 1]!.id],
          selectedConnection: null,
        };
      });
    },
    [runUserCanvasMutation]
  );

  const submitCopilotPrompt = useCallback(async () => {
    if (copilotActiveJobId || !copilotRunPreview.requestPayload) {
      return;
    }

    const prompt = copilotDraft.trim();
    if (!prompt) {
      return;
    }

    const userMessageId = uid();
    const statusMessageId = uid();
    setCopilotMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        text: prompt,
        createdAt: new Date().toISOString(),
      },
      {
        id: statusMessageId,
        role: "system",
        text: `Running ${copilotRunPreview.model?.displayName || "selected model"}...`,
        createdAt: new Date().toISOString(),
        state: "pending",
        jobId: null,
      },
    ]);

    try {
      const job = await createJobFromRequest(projectId, {
        ...copilotRunPreview.requestPayload,
        nodePayload: {
          ...copilotRunPreview.requestPayload.nodePayload,
          nodeId: `copilot-${uid()}`,
        },
      });
      setJobs((prev) => [job, ...prev.filter((existingJob) => existingJob.id !== job.id)]);
      setCopilotActiveJobId(job.id);
      setCopilotDraft("");
      setCopilotMessages((prev) =>
        prev.map((message) =>
          message.id === statusMessageId
            ? {
                ...message,
                jobId: job.id,
              }
            : message
        )
      );
      await fetchJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Copilot request failed.";
      setCopilotMessages((prev) =>
        prev.map((entry) =>
          entry.id === statusMessageId
            ? {
                ...entry,
                text: message,
                state: "error",
              }
            : entry
        )
      );
    }
  }, [copilotActiveJobId, copilotDraft, copilotRunPreview, fetchJobs, projectId]);

  const runNode = useCallback(
    async (node: WorkflowNode) => {
      if (node.kind === "text-template") {
        generateTextTemplateOutputs(node.id);
        return;
      }

      if (node.kind !== "model" || node.sourceAssetId) {
        return;
      }

      const requestPreview = buildNodeRunRequest(node);
      if (requestPreview.disabledReason) {
        return;
      }

      const job = await createJobFromRequest(projectId, requestPreview.requestPayload);
      setJobs((prev) => [job, ...prev.filter((existingJob) => existingJob.id !== job.id)]);
      if (requestPreview.requestPayload.nodePayload.outputType === "text") {
        const textOutputTarget = getTextOutputTargetFromSettings(requestPreview.requestPayload.nodePayload.settings);
        if (textOutputTarget !== "smart") {
          insertGeneratedTextOutputPlaceholder(
            job,
            node.id,
            textOutputTarget === "list" ? "list" : textOutputTarget === "template" ? "template" : "note"
          );
        }
      } else {
        insertGeneratedOutputPlaceholder(job, node.id, requestPreview.requestPayload.nodePayload.outputCount);
      }
      await fetchJobs();
    },
    [
      buildNodeRunRequest,
      fetchJobs,
      generateTextTemplateOutputs,
      insertGeneratedOutputPlaceholder,
      insertGeneratedTextOutputPlaceholder,
      projectId,
    ]
  );

  useEffect(() => {
    if (!copilotActiveJobId) {
      return;
    }

    const activeJob = jobs.find((job) => job.id === copilotActiveJobId && job.nodeRunPayload?.runOrigin === "copilot") || null;
    if (!activeJob) {
      return;
    }

    if (activeJob.state !== "failed" && activeJob.state !== "canceled") {
      return;
    }

    setCopilotMessages((prev) =>
      prev.map((message) =>
        message.jobId === activeJob.id
          ? {
              ...message,
              text:
                activeJob.state === "canceled"
                  ? "Copilot run canceled."
                  : activeJob.errorMessage || "Copilot request failed.",
              state: "error",
            }
          : message
      )
    );
    setCopilotActiveJobId(null);
  }, [copilotActiveJobId, jobs]);

  const openImportDialog = useCallback(async () => {
    const imported = await importProjectAssets(projectId);
    await addImportedAssetsToCanvas(
      imported.map((item) => item.asset),
      pendingUploadAnchorRef.current
        ? { x: pendingUploadAnchorRef.current.x, y: pendingUploadAnchorRef.current.y }
        : undefined,
      pendingUploadAnchorRef.current?.connectToModelNodeId
        ? { connectToModelNodeId: pendingUploadAnchorRef.current.connectToModelNodeId }
        : undefined,
      imported.map((item) => item.sourceName || "")
    );
    pendingUploadAnchorRef.current = null;
  }, [addImportedAssetsToCanvas, projectId]);

  const openAssetViewer = useCallback(
    (assetId: string) => {
      router.push(`/projects/${projectId}/assets/${assetId}`);
    },
    [projectId, router]
  );

  const openCompare = useCallback(
    (mode: "compare_2" | "compare_4", count: number) => {
      if (selectedImageAssetIds.length !== count) {
        return;
      }

      const assetIds = selectedImageAssetIds.slice(0, count);
      const params = new URLSearchParams({
        layout: mode,
        assetIds: assetIds.join(","),
      });
      router.push(`/projects/${projectId}/assets?${params.toString()}`);
    },
    [projectId, router, selectedImageAssetIds]
  );

  const downloadAssets = useCallback((assetIds: string[]) => {
    const uniqueAssetIds = assetIds.filter((assetId, index) => assetIds.indexOf(assetId) === index);
    for (const assetId of uniqueAssetIds) {
      const link = document.createElement("a");
      link.href = getAssetFileUrl(assetId);
      link.download = "";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, []);

  const openQueueInspect = useCallback(
    (jobId: string) => {
      router.push(`/projects/${projectId}/queue/${jobId}`);
    },
    [projectId, router]
  );

  const handleNodeDisplayModeChange = useCallback(
    (nodeId: string, mode: "preview" | "compact") => {
      updateNode(
        nodeId,
        {
          displayMode: mode,
          size: null,
        },
        {
          historyMode: "immediate",
        }
      );

      if (activeFullNodeIdRef.current === nodeId) {
        setActiveFullNodeId(null);
      }
      if (pinnedModelFullNodeIdRef.current === nodeId) {
        setPinnedModelFullNodeId(null);
      }
    },
    [updateNode]
  );

  const handleNodeResizeStart = useCallback(
    (nodeId: string, size: WorkflowNodeSize) => {
      const node = nodesById[nodeId];
      if (!node || node.kind !== "model" || node.displayMode === "resized") {
        return;
      }

      updateNode(
        nodeId,
        {
          displayMode: "resized",
          size,
        },
        {
          historyMode: "coalesced",
          historyKey: `node:${nodeId}:resize`,
        }
      );
      if (activeFullNodeIdRef.current === nodeId) {
        setActiveFullNodeId(null);
      }
      if (pinnedModelFullNodeIdRef.current === nodeId) {
        setPinnedModelFullNodeId(null);
      }
    },
    [nodesById, updateNode]
  );

  const handleNodeSizeCommit = useCallback(
    (nodeId: string, size: WorkflowNodeSize) => {
      const node = nodesById[nodeId];
      updateNode(
        nodeId,
        {
          displayMode: "resized",
          size,
        },
        {
          historyMode: node?.kind === "model" ? "coalesced" : "immediate",
          historyKey: node?.kind === "model" ? `node:${nodeId}:resize` : undefined,
        }
      );
      if (node?.kind === "model") {
        if (activeFullNodeIdRef.current === nodeId) {
          setActiveFullNodeId(null);
        }
        if (pinnedModelFullNodeIdRef.current === nodeId) {
          setPinnedModelFullNodeId(null);
        }
      }
    },
    [nodesById, updateNode]
  );

  const activeEditor = useMemo<ActiveCanvasNodeEditorState | null>(() => {
    if (!activeSelectedNode) {
      return null;
    }

    return {
      nodeId: activeSelectedNode.id,
      selectedNode: activeSelectedNode,
      selectedModel: activeSelectedNode.kind === "model" ? selectedModel : undefined,
      selectedNodeRunPreview: activeSelectedNode.kind === "model" ? selectedNodeRunPreview : null,
      selectedNodeResolvedSettings: activeSelectedNode.kind === "model" ? selectedNodeResolvedSettings : {},
      selectedCoreParameters: activeSelectedNode.kind === "model" ? selectedCoreParameters : [],
      selectedAdvancedParameters: activeSelectedNode.kind === "model" ? selectedAdvancedParameters : [],
      selectedInputNodes,
      selectedPromptSourceNode,
      selectedListSettings,
      selectedTemplatePreview,
      selectedTemplateListNode,
      selectedNodeSourceJobId,
      selectedSingleImageAssetId,
      modelCatalogVariants,
    };
  }, [
    activeSelectedNode,
    modelCatalogVariants,
    selectedAdvancedParameters,
    selectedCoreParameters,
    selectedInputNodes,
    selectedListSettings,
    selectedModel,
    selectedNodeResolvedSettings,
    selectedNodeRunPreview,
    selectedNodeSourceJobId,
    selectedPromptSourceNode,
    selectedSingleImageAssetId,
    selectedTemplateListNode,
    selectedTemplatePreview,
  ]);

  const buildPassiveModelEditor = useCallback(
    (node: CanvasRenderNode): CanvasModelEditorState | null => {
      if (node.kind !== "model") {
        return null;
      }

      const selectedModel =
        providers.find((model) => model.providerId === node.providerId && model.modelId === node.modelId) || undefined;
      const executionMode = getExecutionModeForModel(selectedModel, node.upstreamNodeIds);
      const selectedNodeResolvedSettings = resolveModelSettings(
        selectedModel,
        node.settings,
        executionMode
      ) as Record<string, unknown>;
      const visibleParameters = (selectedModel?.capabilities.parameters || []).filter((parameter) =>
        isModelParameterVisible(parameter, {
          executionMode,
          settings: selectedNodeResolvedSettings,
        })
      );
      const selectedInputNodes = node.upstreamNodeIds
        .map((nodeId) => nodesById[nodeId] || null)
        .filter((inputNode): inputNode is WorkflowNode => Boolean(inputNode));

      return {
        selectedNode: node,
        selectedModel,
        selectedNodeResolvedSettings,
        selectedCoreParameters: visibleParameters.filter((parameter) => parameter.section === "core"),
        selectedAdvancedParameters: visibleParameters.filter((parameter) => parameter.section === "advanced"),
        selectedInputNodes,
        selectedPromptSourceNode: node.promptSourceNodeId ? nodesById[node.promptSourceNodeId] || null : null,
        modelCatalogVariants,
      };
    },
    [getExecutionModeForModel, modelCatalogVariants, nodesById, providers]
  );

  const renderNodeContent = useCallback(
    (node: CanvasRenderNode) => {
      const passiveModelEditor =
        node.kind === "model" &&
        (node.presentation.renderMode === "resized" || node.presentation.renderMode === "full") &&
        activeEditor?.nodeId !== node.id
          ? buildPassiveModelEditor(node)
          : null;

      return (
        <CanvasNodeContent
          node={node}
          activeEditor={activeEditor}
          passiveModelEditor={passiveModelEditor}
          pickerDismissKey={`${selectedNodeIds.join(",")}|${canvasDoc.canvasViewport.x.toFixed(2)}:${canvasDoc.canvasViewport.y.toFixed(2)}:${canvasDoc.canvasViewport.zoom.toFixed(3)}|${node.presentation.renderMode}|${node.resolvedSize.width}x${node.resolvedSize.height}`}
          onSetDisplayMode={(mode) => handleNodeDisplayModeChange(node.id, mode)}
          onEnterEditMode={() => enterNodeEditMode(node.id)}
          onExitEditMode={() => {
            if (activeFullNodeIdRef.current === node.id) {
              setActiveFullNodeId(null);
            }
            if (pinnedModelFullNodeIdRef.current === node.id) {
              setPinnedModelFullNodeId(null);
            }
          }}
          onRunNode={() => {
            const currentNode = nodesById[node.id];
            if (currentNode) {
              runNode(currentNode).catch(console.error);
            }
          }}
          onLabelChange={handleSelectedNodeLabelChange}
          onPromptChange={handleSelectedNodePromptChange}
          onModelVariantChange={handleSelectedNodeModelVariantChange}
          onParameterChange={updateSelectedModelParameter}
          onUpdateListColumnLabel={updateSelectedListColumnLabel}
          onUpdateListCell={updateSelectedListCell}
          onAddListColumn={addSelectedListColumn}
          onRemoveListColumn={removeSelectedListColumn}
          onAddListRow={addSelectedListRow}
          onRemoveListRow={removeSelectedListRow}
          onClearInputs={handleClearSelectedInputs}
          onDuplicateNode={() => duplicateNode(node.id)}
          onOpenAssetViewer={openAssetViewer}
          onDownloadAssets={downloadAssets}
          onOpenQueueInspect={openQueueInspect}
          onCommitTextEdits={commitPendingCoalescedHistory}
        />
      );
    },
    [
      activeEditor,
      addSelectedListColumn,
      addSelectedListRow,
      buildPassiveModelEditor,
      canvasDoc.canvasViewport,
      commitPendingCoalescedHistory,
      downloadAssets,
      duplicateNode,
      enterNodeEditMode,
      handleClearSelectedInputs,
      handleNodeDisplayModeChange,
      handleSelectedNodeLabelChange,
      handleSelectedNodePromptChange,
      handleSelectedNodeModelVariantChange,
      nodesById,
      openAssetViewer,
      openQueueInspect,
      removeSelectedListColumn,
      removeSelectedListRow,
      runNode,
      selectedNodeIds,
      updateSelectedListCell,
      updateSelectedListColumnLabel,
      updateSelectedModelParameter,
    ]
  );

  const activePhantomPreview = useMemo<CanvasPhantomPreview | null>(() => {
    if (!activeSelectedNode) {
      return null;
    }

    if (activeSelectedNode.kind === "text-template") {
      if (activeFullNodeId === activeSelectedNode.id) {
        return null;
      }

      if (!selectedTemplatePreview || selectedTemplatePreview.rows.length === 0) {
        return null;
      }

      const visibleRows = selectedTemplatePreview.rows.slice(0, 4);
      return {
        sourceNodeId: activeSelectedNode.id,
        nodes: visibleRows.map((row) => ({
          id: `template-preview-${row.rowId}`,
          kind: "text-note",
          label: `Row ${row.rowIndex + 1}`,
          width: 232,
          height: 88,
        })),
        overflowCount: Math.max(0, selectedTemplatePreview.rows.length - visibleRows.length),
        runDisabledReason: selectedTemplatePreview.disabledReason,
      };
    }

    if (activeSelectedNode.kind !== "model" || !selectedNodeRunPreview) {
      return null;
    }

    if (activeSelectedNode.outputType === "text") {
      const target = readOpenAiTextOutputTarget(selectedNodeResolvedSettings.textOutputTarget);
      const kind =
        target === "list"
          ? "list"
          : target === "template"
            ? "text-template"
            : target === "smart"
              ? "mystery"
              : "text-note";

      return {
        sourceNodeId: activeSelectedNode.id,
        nodes: [
          {
            id: `${activeSelectedNode.id}-phantom-text`,
            kind,
            label:
              target === "smart"
                ? "Structured outputs"
                : target === "list"
                  ? "List output"
                  : target === "template"
                    ? "Template output"
                    : "Text note output",
            width: kind === "list" ? 248 : kind === "text-template" ? 264 : 212,
            height: kind === "list" ? 152 : kind === "text-template" ? 144 : 104,
          },
        ],
        overflowCount: 0,
        runDisabledReason: selectedNodeRunPreview.disabledReason,
      };
    }

    const outputCount = Math.max(1, Math.min(4, selectedNodeRunPreview.requestPayload.nodePayload.outputCount || 1));
    return {
      sourceNodeId: activeSelectedNode.id,
      nodes: Array.from({ length: outputCount }, (_, index) => ({
        id: `${activeSelectedNode.id}-phantom-asset-${index}`,
        kind: "asset",
        label: `Output ${index + 1}`,
        width: 176,
        height: 176,
        aspectRatio: 1,
      })),
      overflowCount: Math.max(0, (selectedNodeRunPreview.requestPayload.nodePayload.outputCount || 1) - outputCount),
      runDisabledReason: selectedNodeRunPreview.disabledReason,
    };
  }, [activeFullNodeId, activeSelectedNode, selectedNodeResolvedSettings.textOutputTarget, selectedNodeRunPreview, selectedTemplatePreview]);

  const selectionActions = useMemo<CanvasSelectionAction[]>(() => {
    const actions: CanvasSelectionAction[] = [];

    if (selectedImageAssetIds.length > 0) {
      actions.push({
        id: "download-assets",
        label: selectedImageAssetIds.length === 1 ? "Download Asset" : `Download ${selectedImageAssetIds.length}`,
        onClick: () => downloadAssets(selectedImageAssetIds),
      });
    }

    if (selectedImageAssetIds.length === 2) {
      actions.push({
        id: "compare-2",
        label: "Compare 2-Up",
        onClick: () => openCompare("compare_2", 2),
      });
    }

    if (selectedImageAssetIds.length === 4) {
      actions.push({
        id: "compare-4",
        label: "Compare 4-Up",
        onClick: () => openCompare("compare_4", 4),
      });
    }

    return actions;
  }, [downloadAssets, openCompare, selectedImageAssetIds]);

  const insertMenuTargetNode =
    insertMenu?.mode === "model-input" && insertMenu.connectToNodeId ? nodesById[insertMenu.connectToNodeId] || null : null;
  const insertMenuTargetIsTextModel =
    insertMenuTargetNode?.kind === "model" &&
    isRunnableTextModel(insertMenuTargetNode.providerId, insertMenuTargetNode.modelId);
  const insertMenuAllowsAssetInputs = insertMenu
    ? insertMenu.mode === "canvas" || (insertMenu.mode === "model-input" && !insertMenuTargetIsTextModel)
    : false;
  const insertMenuEntries = useMemo(
    () =>
      insertMenu
        ? getInsertableNodeCatalogEntries(insertMenu.mode, providers).filter((entry) =>
            entry.id === "asset-uploaded" || entry.id === "asset-generated" ? insertMenuAllowsAssetInputs : true
          )
        : [],
    [insertMenu, insertMenuAllowsAssetInputs, providers]
  );
  const canUndo = historyStacks.undo.length > 0;
  const canRedo = historyStacks.redo.length > 0;

  useEffect(() => {
    publishCanvasMenuState({
      selectedNodeCount: selectedNodeIds.length,
      canConnectSelected,
      canDuplicateSelected,
      canUndo,
      canRedo,
    });
  }, [canConnectSelected, canDuplicateSelected, canRedo, canUndo, selectedNodeIds.length]);

  useEffect(() => {
    return () => {
      resetCanvasMenuState();
    };
  }, []);

  useEffect(() => {
    const testingWindow = window as Window & {
      __NND_CANVAS_TEST__?: {
        selectNodes: (nodeIds: string[]) => void;
        moveSelectedNodesBy: (deltaX: number, deltaY: number) => void;
        connectSelected: () => void;
        openPrimaryEditor: (nodeId: string) => void;
        focusAndOpenNode: (nodeId: string) => void;
        setDisplayMode: (nodeId: string, mode: "preview" | "compact") => void;
        resizeNode: (nodeId: string, size: WorkflowNodeSize) => void;
        getState: () => {
          selectedNodeIds: string[];
          activeFullNodeId: string | null;
          pinnedModelFullNodeId: string | null;
          canvasViewport: CanvasDocument["canvasViewport"];
          canUndo: boolean;
          canRedo: boolean;
        };
      };
    };

    const api = {
      selectNodes: (nodeIds: string[]) => {
        commitPendingCoalescedHistory();
        setTrackedSelectedConnection(null);
        const validNodeIds = new Set(canvasDocRef.current.workflow.nodes.map((node) => node.id));
        setTrackedSelectedNodeIds(nodeIds.filter((nodeId) => validNodeIds.has(nodeId)));
      },
      moveSelectedNodesBy: (deltaX: number, deltaY: number) => {
        const positions = selectedNodeIdsRef.current.reduce<Record<string, { x: number; y: number }>>((acc, nodeId) => {
          const node = canvasDocRef.current.workflow.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) {
            return acc;
          }

          acc[nodeId] = {
            x: Math.round(node.x + deltaX),
            y: Math.round(node.y + deltaY),
          };
          return acc;
        }, {});

        commitNodePositions(positions);
      },
      connectSelected: () => {
        connectSelectedNodes();
      },
      openPrimaryEditor: (nodeId: string) => {
        if (canvasDocRef.current.workflow.nodes.some((node) => node.id === nodeId)) {
          openPrimaryEditorForNode(nodeId);
        }
      },
      focusAndOpenNode: (nodeId: string) => {
        if (canvasDocRef.current.workflow.nodes.some((node) => node.id === nodeId)) {
          focusAndOpenNode(nodeId);
        }
      },
      setDisplayMode: (nodeId: string, mode: "preview" | "compact") => {
        if (canvasDocRef.current.workflow.nodes.some((node) => node.id === nodeId)) {
          handleNodeDisplayModeChange(nodeId, mode);
        }
      },
      resizeNode: (nodeId: string, size: WorkflowNodeSize) => {
        if (canvasDocRef.current.workflow.nodes.some((node) => node.id === nodeId)) {
          handleNodeSizeCommit(nodeId, size);
        }
      },
      getState: () => ({
        selectedNodeIds: [...selectedNodeIdsRef.current],
        activeFullNodeId: activeFullNodeIdRef.current,
        pinnedModelFullNodeId: pinnedModelFullNodeIdRef.current,
        canvasViewport: canvasDocRef.current.canvasViewport,
        canUndo: historyStacksRef.current.undo.length > 0,
        canRedo: historyStacksRef.current.redo.length > 0,
      }),
    };

    testingWindow.__NND_CANVAS_TEST__ = api;
    return () => {
      if (testingWindow.__NND_CANVAS_TEST__ === api) {
        delete testingWindow.__NND_CANVAS_TEST__;
      }
    };
  }, [
    commitNodePositions,
    commitPendingCoalescedHistory,
    connectSelectedNodes,
    handleNodeDisplayModeChange,
    handleNodeResizeStart,
    handleNodeSizeCommit,
    focusAndOpenNode,
    openPrimaryEditorForNode,
    setTrackedSelectedConnection,
    setTrackedSelectedNodeIds,
  ]);

  return (
    <WorkspaceShell
      projectId={projectId}
      view="canvas"
      jobs={jobs}
    >
      <div className={styles.page}>
        <div ref={canvasSurfaceRef} className={styles.canvasSurface}>
          {isLoading ? (
            <div className={styles.loading}>Loading canvas...</div>
          ) : (
            <InfiniteCanvas
              nodes={canvasNodes}
              selectedNodeIds={selectedNodeIds}
              selectedConnectionId={selectedConnection?.id || null}
              viewport={canvasDoc.canvasViewport}
              onSelectSingleNode={selectSingleNode}
              onToggleNodeSelection={toggleNodeSelection}
              onMarqueeSelectNodes={addNodesToSelection}
              onRequestInsertMenu={handleCanvasInsertRequest}
              onDropFiles={(files, position) => {
                uploadFilesToCanvas(files, position).catch(console.error);
              }}
              onViewportChange={updateViewport}
              onViewportInteractionStart={handleViewportInteractionStart}
              onCommitNodePositions={commitNodePositions}
              onStartNodeResize={handleNodeResizeStart}
              onCommitNodeSize={handleNodeSizeCommit}
              onConnectNodes={connectNodes}
              onSelectConnection={selectCanvasConnection}
              onNodeActivate={openPrimaryEditorForNode}
              onNodeDoubleClick={focusAndOpenNode}
              renderNodeContent={renderNodeContent}
              activePhantomPreview={activePhantomPreview}
              onRunActiveNode={(nodeId) => {
                const node = nodesById[nodeId];
                if (node) {
                  runNode(node).catch(console.error);
                }
              }}
              selectionActions={selectionActions}
            />
          )}
        </div>

        {!isLoading ? (
          <CanvasCopilotWidget
            open={copilotOpen}
            modelVariantId={copilotRunPreview.variant?.id || copilotModelVariantId}
            modelOptions={copilotModelVariants}
            draft={copilotDraft}
            messages={copilotMessages}
            isRunning={Boolean(copilotActiveJobId)}
            disabledReason={copilotRunPreview.disabledReason}
            readyMessage={copilotRunPreview.readyMessage}
            onOpenChange={setCopilotOpen}
            onModelVariantChange={setCopilotModelVariantId}
            onDraftChange={setCopilotDraft}
            onSubmit={() => {
              submitCopilotPrompt().catch(console.error);
            }}
          />
        ) : null}

        {insertMenu ? (
          <div
            ref={insertMenuRef}
            className={styles.insertMenu}
            style={{
              left: insertMenu.clientX,
              top: insertMenu.clientY,
            }}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
            }}
          >
            <div className={styles.insertMenuColumns}>
              <div className={styles.insertMenuPrimaryColumn}>
                <div className={styles.insertMenuTitle}>
                  {insertMenu.mode === "model-input"
                    ? "Add Model Input"
                    : insertMenu.mode === "template-input"
                      ? "Add Template Input"
                      : "Add To Canvas"}
                </div>
                <div className={styles.insertMenuPrimaryList}>
                  {insertMenuEntries.map((entry) => {
                    if (entry.id === "model") {
                      return (
                        <div
                          key={entry.id}
                          className={styles.insertMenuSubmenuGroup}
                          onMouseEnter={() => {
                            setInsertMenuExpandedEntryId(entry.id);
                          }}
                        >
                          <div className={styles.insertMenuRow}>
                            <button
                              type="button"
                              className={`${styles.insertMenuPrimaryButton} ${styles.insertMenuAction}`}
                              onClick={() =>
                                handleInsertCatalogEntry(
                                  "model",
                                  insertMenu,
                                  { x: insertMenu.worldX, y: insertMenu.worldY },
                                  {
                                    providerId: defaultModelCatalogVariant.providerId,
                                    modelId: defaultModelCatalogVariant.modelId,
                                  }
                                )
                              }
                            >
                              Add Model Node
                            </button>
                            <button
                              type="button"
                              className={`${styles.insertMenuPrimaryButton} ${styles.insertMenuDisclosure}`}
                              aria-expanded={insertMenuExpandedEntryId === entry.id}
                              onClick={() =>
                                setInsertMenuExpandedEntryId((current) => (current === entry.id ? null : entry.id))
                              }
                            >
                              ▸
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={styles.insertMenuPrimaryButton}
                        onClick={() =>
                          handleInsertCatalogEntry(
                            entry.id,
                            insertMenu,
                            {
                              x: insertMenu.worldX,
                              y: insertMenu.worldY,
                            }
                          )
                        }
                      >
                        {entry.id === "asset-uploaded"
                          ? "Add Uploaded Assets"
                          : entry.id === "asset-generated"
                            ? "Add Generated Asset"
                            : `Add ${entry.label}`}
                      </button>
                    );
                  })}
                  {insertMenuAllowsAssetInputs ? (
                    <button
                      type="button"
                      className={styles.insertMenuPrimaryButton}
                      onClick={() => {
                        pendingUploadAnchorRef.current = {
                          x: insertMenu.worldX,
                          y: insertMenu.worldY,
                          connectToModelNodeId:
                            insertMenu.mode === "model-input" ? insertMenu.connectToNodeId : undefined,
                        };
                        setInsertMenu(null);
                        void openImportDialog();
                      }}
                    >
                      Upload Assets
                    </button>
                  ) : null}
                </div>
              </div>

              {insertMenuExpandedEntryId === "model" ? (
                <div className={styles.insertMenuSecondaryColumn}>
                  <div className={styles.insertMenuSecondaryTitle}>Model Variants</div>
                  <div className={styles.insertMenuSubmenu}>
                    {Object.entries(groupedModelCatalogVariants).map(([providerId, variants]) => (
                      <div key={providerId} className={styles.insertMenuProviderGroup}>
                        <span className={styles.insertMenuProviderLabel}>{variants[0]?.providerLabel || providerId}</span>
                        {variants.map((variant) => (
                          <button
                            key={variant.id}
                            type="button"
                            className={styles.insertMenuVariantButton}
                            onClick={() =>
                              handleInsertCatalogEntry(
                                "model",
                                insertMenu,
                                { x: insertMenu.worldX, y: insertMenu.worldY },
                                { providerId: variant.providerId, modelId: variant.modelId }
                              )
                            }
                          >
                            <span className={styles.insertMenuVariantLabel}>{variant.label}</span>
                            <span
                              className={`${styles.insertMenuVariantStatus} ${insertMenuVariantStatusClassName(
                                variant.status
                              )}`}
                            >
                              {variant.availabilityLabel}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {assetPicker ? (
          <div className={styles.assetPickerBackdrop}>
            <section ref={assetPickerRef} className={styles.assetPickerModal}>
              <header className={styles.assetPickerHeader}>
                <div>
                  <strong>{assetPicker.origin === "generated" ? "Add Generated Asset" : "Add Uploaded Assets"}</strong>
                  <span>
                    {assetPicker.origin === "generated"
                      ? "Spawn pointer nodes to previous generations."
                      : "Browse uploaded assets already in this project."}
                  </span>
                </div>
                <button type="button" onClick={() => setAssetPicker(null)}>
                  Close
                </button>
              </header>

              <div className={styles.assetPickerToolbar}>
                <input
                  className={styles.assetPickerSearch}
                  value={assetPickerQuery}
                  onChange={(event) => setAssetPickerQuery(event.target.value)}
                  placeholder="Search by id, provider, model, or storage ref"
                />
                <div className={styles.assetPickerMeta}>
                  {assetPickerLoading ? "Loading…" : `${assetPickerAssets.length} asset${assetPickerAssets.length === 1 ? "" : "s"}`}
                </div>
              </div>

              {assetPickerError ? <div className={styles.assetPickerError}>{assetPickerError}</div> : null}

              <div className={styles.assetPickerList}>
                {assetPickerAssets.map((asset, index) => {
                  const isSelected = assetPickerSelectedIds.includes(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`${styles.assetPickerItem} ${isSelected ? styles.assetPickerItemSelected : ""}`}
                      onClick={() =>
                        setAssetPickerSelectedIds((prev) =>
                          prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]
                        )
                      }
                    >
                      {asset.type === "image" ? (
                        <img className={styles.assetPickerThumb} src={getAssetFileUrl(asset.id)} alt={asset.id} />
                      ) : (
                        <div className={styles.assetPickerThumbPlaceholder}>{asset.type.toUpperCase()}</div>
                      )}
                      <div className={styles.assetPickerItemMeta}>
                        <strong>{getAssetPointerNodeLabel(asset, index)}</strong>
                        <span>
                          {asset.origin === "generated"
                            ? `${asset.job?.providerId || "generated"} / ${asset.job?.modelId || "unknown"}`
                            : "Uploaded Asset"}
                        </span>
                        <span>{new Date(asset.createdAt).toLocaleString()}</span>
                      </div>
                    </button>
                  );
                })}
                {!assetPickerLoading && assetPickerAssets.length === 0 ? (
                  <div className={styles.assetPickerEmpty}>No matching assets found.</div>
                ) : null}
              </div>

              <footer className={styles.assetPickerActions}>
                <span>{assetPickerSelectedIds.length} selected</span>
                <button type="button" onClick={() => setAssetPicker(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={assetPickerSelectedIds.length === 0}
                  onClick={() => {
                    const selectedAssets = assetPickerAssets.filter((asset) => assetPickerSelectedIds.includes(asset.id));
                    spawnAssetPointerNodes(
                      selectedAssets,
                      {
                        x: assetPicker.worldX,
                        y: assetPicker.worldY,
                      },
                      assetPicker.connectToModelNodeId
                        ? { connectToModelNodeId: assetPicker.connectToModelNodeId }
                        : undefined
                    );
                  }}
                >
                  Add Selected
                </button>
              </footer>
            </section>
          </div>
        ) : null}

      </div>
    </WorkspaceShell>
  );
}
