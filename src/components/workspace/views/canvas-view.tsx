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
import { CanvasBottomBar } from "@/components/workspace/views/canvas-bottom-bar";
import { InfiniteCanvas, type CanvasConnection, type CanvasInsertRequest } from "@/components/infinite-canvas";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { isModelParameterVisible } from "@/lib/model-parameters";
import {
  buildOpenAiImageDebugRequest,
  getOpenAiImageDefaultSettings,
  getOpenAiImageParameterDefinitions,
  isRunnableOpenAiImageModel,
  OPENAI_IMAGE_INPUT_MIME_TYPES,
  OPENAI_MAX_INPUT_IMAGES,
  resolveOpenAiImageSettings,
} from "@/lib/openai-image-settings";
import {
  applyGeneratedDescriptorToNode,
  buildGeneratedNodePosition,
  createGeneratedModelNode,
  getGeneratedDescriptorDefaultLabel,
  getGeneratedNodeDescriptorKey,
  type GeneratedNodeDescriptor,
  type GeneratedNodeKind,
} from "@/lib/generated-text-output";
import {
  buildOpenAiTextDebugRequest,
  isRunnableOpenAiTextModel,
  resolveOpenAiTextSettings,
} from "@/lib/openai-text-settings";
import { formatProviderRequirementMessage, getFirstUnconfiguredRequirement } from "@/lib/provider-readiness";
import {
  buildTopazGigapixelDebugRequest,
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
} from "@/components/workspace/types";
import {
  buildTextTemplatePreview,
  createDefaultListNodeSettings,
  createGeneratedTextNoteSettings,
  createTextNoteSettings,
  createTextTemplateNodeSettings,
  getGeneratedModelNodeSource,
  getGeneratedModelTextNoteSettings,
  getGeneratedTextNoteSettings,
  getListNodeSettings,
  getTextTemplateNodeSettings,
  isGeneratedTextNoteNode,
} from "@/lib/list-template";
import { getOpenAiTextOutputTargetLabel, readOpenAiTextOutputTarget } from "@/lib/text-output-targets";
import { canConnectCanvasNodes } from "@/lib/canvas-connection-rules";
import {
  applyCanvasHistoryPatch,
  createCanvasHistoryPatch,
  type CanvasHistoryPatch,
  type CanvasHistoryState,
} from "@/lib/canvas-history";
import {
  resolvePrimaryCanvasEditorId,
  type CanvasBottomBarPopoverId,
} from "@/lib/canvas-primary-editor";
import { subscribeToCanvasMenuCommand } from "@/renderer/canvas-menu-command-bus";
import { publishCanvasMenuState, resetCanvasMenuState } from "@/renderer/canvas-menu-context-bus";
import styles from "./canvas-view.module.css";

const supportedOutputOrder = ["image", "video", "text"] as const;
const generatedNodeBaseOffsetX = 328;
const generatedNodeColumnOffsetX = 40;
const generatedNodeOffsetY = 38;
const generatedTextNodeOffsetX = 320;
const generatedTextNodeOffsetY = 172;
const CANVAS_HISTORY_LIMIT = 100;
const COALESCED_HISTORY_DELAY_MS = 450;

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
type CanvasSemanticType = WorkflowNode["outputType"] | "function" | "citrus";
const canvasSemanticTypeOrder: CanvasSemanticType[] = ["text", "image", "video", "function", "citrus"];

type CanvasHistoryStacks = {
  undo: CanvasHistoryPatch<CanvasConnection>[];
  redo: CanvasHistoryPatch<CanvasConnection>[];
};

type PendingCoalescedCanvasHistory = {
  key: string;
  beforeState: CanvasHistoryState<CanvasConnection>;
  afterState: CanvasHistoryState<CanvasConnection>;
};

function getNodeSemanticOutputType(node: WorkflowNode): CanvasSemanticType {
  if (node.kind === "text-template") {
    return "function";
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

  if (isRunnableOpenAiImageModel(model?.providerId, model?.modelId)) {
    return resolveOpenAiImageSettings(mergedSettings, executionMode, model?.modelId).effectiveSettings;
  }

  if (isRunnableOpenAiTextModel(model?.providerId, model?.modelId)) {
    return resolveOpenAiTextSettings(mergedSettings, model?.modelId).effectiveSettings;
  }

  if (isRunnableTopazGigapixelModel(model?.providerId, model?.modelId)) {
    return resolveTopazGigapixelSettings(mergedSettings, model?.modelId).effectiveSettings;
  }

  return mergedSettings;
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

function outputTypeFromAssetType(type: Asset["type"]): WorkflowNode["outputType"] {
  if (type === "video") {
    return "video";
  }
  if (type === "text") {
    return "text";
  }
  return "image";
}

function nextCanvasNodePosition(nodeCount: number, position?: { x: number; y: number }) {
  return {
    x: Math.round(position?.x ?? (120 + (nodeCount % 4) * 260)),
    y: Math.round(position?.y ?? (120 + Math.floor(nodeCount / 4) * 160)),
  };
}

function buildAssetRefsFromNodes(upstreamNodeIds: string[], nodes: WorkflowNode[]) {
  const nodeMap = nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});

  const refs = upstreamNodeIds
    .map((nodeId) => {
      const sourceNode = nodeMap[nodeId];
      if (!sourceNode) {
        return null;
      }
      return sourceNode.sourceAssetId || `node:${nodeId}`;
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(refs)];
}

function fallbackProviderModel(providers: ProviderModel[]): ProviderModel {
  const preferred =
    providers.find((provider) => provider.providerId === "openai" && provider.modelId === "gpt-image-1.5") ||
    providers.find((provider) => provider.capabilities.runnable) ||
    providers[0];
  if (preferred) {
    return preferred;
  }

  return {
    providerId: "openai" as const,
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: false,
      availability: "ready" as const,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: false,
      requirements: [
        {
          kind: "env" as const,
          key: "OPENAI_API_KEY",
          configured: false,
          label: "OpenAI API key",
        },
      ],
      promptMode: "required" as const,
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: OPENAI_IMAGE_INPUT_MIME_TYPES,
      maxInputImages: OPENAI_MAX_INPUT_IMAGES,
      parameters: getOpenAiImageParameterDefinitions("gpt-image-1.5"),
      defaults: getOpenAiImageDefaultSettings("gpt-image-1.5"),
    },
  };
}

function normalizeAssetNodeLabel(fileName: string, index: number) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 26)}...`;
}

function getAssetPointerNodeLabel(asset: Asset, index: number) {
  if (asset.origin === "generated") {
    const variant =
      typeof asset.outputIndex === "number" ? ` ${asset.outputIndex + 1}` : index > 0 ? ` ${index + 1}` : "";
    return `Generated${variant}`;
  }

  const fileName = asset.storageRef.split("/").at(-1) || "";
  if (fileName.trim()) {
    return normalizeAssetNodeLabel(fileName, index);
  }
  return `Upload ${index + 1}`;
}

function getPreviewFrameUrl(projectId: string, jobId: string, previewFrame: PreviewFrameSummary) {
  return getPreviewFrameFileUrl(previewFrame.id, previewFrame.createdAt);
}

function getImportedAssetNodeLabel(asset: Asset, index: number) {
  const fileName = asset.storageRef.split("/").at(-1) || "";
  return normalizeAssetNodeLabel(fileName, index);
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

function getNodeSourceDescriptorIndex(node: WorkflowNode | null | undefined) {
  if (!node) {
    return 0;
  }
  return typeof node.settings.descriptorIndex === "number" ? Number(node.settings.descriptorIndex) : 0;
}

function getSourceModelNodeId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  return typeof node.settings.sourceModelNodeId === "string" ? node.settings.sourceModelNodeId : null;
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
  outputIndex: number,
  visualIndex: number
): WorkflowNode {
  return {
    id: uid(),
    label: getGeneratedNodeLabel(visualIndex),
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
    x: Math.round(modelNode.x + generatedNodeBaseOffsetX + Math.floor(visualIndex / 4) * generatedNodeColumnOffsetX),
    y: Math.round(modelNode.y + (visualIndex % 4) * generatedNodeOffsetY),
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
  };
}

function createGeneratedModelPlaceholderNode(
  modelNode: WorkflowNode,
  job: Job,
  sourceNodeId: string,
  target: "note" | "list" | "template",
  visualIndex: number
): WorkflowNode {
  const descriptorKind: GeneratedNodeKind =
    target === "list" ? "list" : target === "template" ? "text-template" : "text-note";
  const descriptor: GeneratedNodeDescriptor =
    descriptorKind === "list"
      ? {
          kind: "list",
          label: getGeneratedDescriptorDefaultLabel("list", visualIndex),
          columns: [],
          rows: [],
          sourceJobId: job.id,
          sourceModelNodeId: sourceNodeId,
          outputIndex: 0,
          descriptorIndex: 0,
        }
      : descriptorKind === "text-template"
        ? {
            kind: "text-template",
            label: getGeneratedDescriptorDefaultLabel("text-template", visualIndex),
            templateText: "",
            sourceJobId: job.id,
            sourceModelNodeId: sourceNodeId,
            outputIndex: 0,
            descriptorIndex: 0,
          }
        : {
            kind: "text-note",
            label: getGeneratedDescriptorDefaultLabel("text-note", visualIndex),
            text: "",
            sourceJobId: job.id,
            sourceModelNodeId: sourceNodeId,
            outputIndex: 0,
            descriptorIndex: 0,
          };

  return createGeneratedModelNode({
    id: uid(),
    providerId: modelNode.providerId,
    modelId: modelNode.modelId,
    modelNodeId: sourceNodeId,
    label: descriptor.label,
    position: buildGeneratedNodePosition({
      modelNode,
      visualIndex,
      baseOffsetX: generatedTextNodeOffsetX,
      offsetY: generatedTextNodeOffsetY,
    }),
    processingState: job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null,
    descriptor,
  });
}

function getExpectedGeneratedTextNodeCount(job: Job) {
  const textOutputTarget = getTextOutputTargetFromSettings(job.nodeRunPayload?.settings);

  if (textOutputTarget === "smart") {
    return (job.generatedNodeDescriptors || []).length;
  }

  return Math.max(1, (job.generatedNodeDescriptors || []).length);
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

function findMatchingGeneratedNodeDescriptor(job: Job, node: WorkflowNode) {
  const sourceJobId = getNodeSourceJobId(node);
  if (!sourceJobId || sourceJobId !== job.id) {
    return null;
  }

  const descriptorIndex = getNodeSourceDescriptorIndex(node);
  const sourceOutputIndex = getNodeSourceOutputIndex(node) ?? 0;

  return (
    (job.generatedNodeDescriptors || []).find(
      (descriptor) =>
        descriptor.descriptorIndex === descriptorIndex &&
        descriptor.outputIndex === sourceOutputIndex &&
        descriptor.sourceJobId === sourceJobId
    ) || null
  );
}

export function CanvasView({ projectId }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [insertMenu, setInsertMenu] = useState<CanvasInsertMenuState | null>(null);
  const [assetPicker, setAssetPicker] = useState<AssetPickerState | null>(null);
  const [assetPickerQuery, setAssetPickerQuery] = useState("");
  const [assetPickerAssets, setAssetPickerAssets] = useState<Asset[]>([]);
  const [assetPickerSelectedIds, setAssetPickerSelectedIds] = useState<string[]>([]);
  const [assetPickerLoading, setAssetPickerLoading] = useState(false);
  const [assetPickerError, setAssetPickerError] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<CanvasConnection | null>(null);
  const [openBottomBarPopoverId, setOpenBottomBarPopoverId] = useState<CanvasBottomBarPopoverId | null>(null);
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

  const groupedProviders = useMemo(() => {
    return providers.reduce<Record<string, ProviderModel[]>>((acc, model) => {
      acc[model.providerId] = acc[model.providerId] || [];
      acc[model.providerId].push(model);
      return acc;
    }, {});
  }, [providers]);

  const providerModelDisplayNames = useMemo(() => {
    return providers.reduce<Record<string, string>>((acc, model) => {
      acc[`${model.providerId}:${model.modelId}`] = model.displayName;
      return acc;
    }, {});
  }, [providers]);

  const nodesById = useMemo(() => {
    return canvasDoc.workflow.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [canvasDoc.workflow.nodes]);

  const selectedNodes = useMemo(() => {
    return selectedNodeIds
      .map((nodeId) => nodesById[nodeId])
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNodeIds]);

  const primarySelectedNodeId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === primarySelectedNodeId) || null,
    [canvasDoc.workflow.nodes, primarySelectedNodeId]
  );

  const selectedNodeIsAssetSource = selectedNode?.kind === "asset-source";
  const selectedNodeIsTextNote = selectedNode?.kind === "text-note";
  const selectedNodeIsList = selectedNode?.kind === "list";
  const selectedNodeIsTextTemplate = selectedNode?.kind === "text-template";
  const selectedNodeIsModel = selectedNode?.kind === "model";
  const selectedNodeIsGeneratedAsset = isGeneratedAssetNode(selectedNode);
  const selectedTemplateGeneratedTextSettings = useMemo(
    () => getGeneratedTextNoteSettings(selectedNode?.settings),
    [selectedNode?.settings]
  );
  const selectedModelGeneratedTextSettings = useMemo(
    () => getGeneratedModelTextNoteSettings(selectedNode?.settings),
    [selectedNode?.settings]
  );
  const selectedGeneratedModelNodeSource = useMemo(
    () => getGeneratedModelNodeSource(selectedNode?.settings),
    [selectedNode?.settings]
  );
  const selectedNodeIsGeneratedTextNote = Boolean(
    selectedTemplateGeneratedTextSettings || selectedModelGeneratedTextSettings
  );
  const selectedNodeIsGeneratedModelNode = Boolean(selectedGeneratedModelNodeSource);

  const selectedModel = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return undefined;
    }
    return providers.find(
      (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
    );
  }, [providers, selectedNode, selectedNodeIsModel]);

  const selectedNodeSourceJobId = useMemo(() => getNodeSourceJobId(selectedNode), [selectedNode]);

  const selectedGeneratedSourceJob = useMemo(() => {
    if (!selectedNodeSourceJobId) {
      return null;
    }
    return jobs.find((job) => job.id === selectedNodeSourceJobId) || null;
  }, [jobs, selectedNodeSourceJobId]);

  const selectedGeneratedTextTemplateNode = useMemo(() => {
    if (!selectedTemplateGeneratedTextSettings) {
      return null;
    }
    return nodesById[selectedTemplateGeneratedTextSettings.sourceTemplateNodeId] || null;
  }, [nodesById, selectedTemplateGeneratedTextSettings]);

  const selectedGeneratedTextListNode = useMemo(() => {
    if (!selectedTemplateGeneratedTextSettings) {
      return null;
    }
    return nodesById[selectedTemplateGeneratedTextSettings.sourceListNodeId] || null;
  }, [nodesById, selectedTemplateGeneratedTextSettings]);

  const selectedGeneratedTextSourceModelNode = useMemo(() => {
    if (!selectedGeneratedModelNodeSource) {
      return null;
    }
    return nodesById[selectedGeneratedModelNodeSource.sourceModelNodeId] || null;
  }, [nodesById, selectedGeneratedModelNodeSource]);

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
      if (isRunnableOpenAiTextModel(model?.providerId, model?.modelId)) {
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
      const displayModelName = providerModelDisplayNames[`${node.providerId}:${node.modelId}`] || node.modelId;
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
          assetOrigin: node.kind === "asset-source" ? ("uploaded" as const) : null,
          sourceModelNodeId: getSourceModelNodeId(node),
          displayModelName:
            node.kind === "list" ? "List" : node.kind === "text-template" ? "Template" : displayModelName,
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
        };
      }

      const sourceJobId = getNodeSourceJobId(node);
      const sourceOutputIndex = getNodeSourceOutputIndex(node);
      const sourceModelNodeId = getSourceModelNodeId(node);
      if (!sourceJobId || typeof sourceOutputIndex !== "number") {
        return {
          ...node,
          assetOrigin: "generated" as const,
          sourceModelNodeId,
          displayModelName,
          displaySourceLabel: displayModelName,
          inputSemanticTypes,
          outputSemanticType: getNodeSemanticOutputType(node),
        };
      }

      const previewFrame = latestPreviewFrameByJobOutputKey.get(`${sourceJobId}:${sourceOutputIndex}`);
      return {
        ...node,
        assetOrigin: "generated" as const,
        sourceModelNodeId,
        displayModelName,
        displaySourceLabel: displayModelName,
        inputSemanticTypes,
        outputSemanticType: getNodeSemanticOutputType(node),
        previewImageUrl: previewFrame ? getPreviewFrameUrl(projectId, sourceJobId, previewFrame) : null,
        hasStartedJob: node.kind === "model" ? startedJobNodeIds.has(node.id) : true,
      };
    });
  }, [canvasDoc.workflow.nodes, latestPreviewFrameByJobOutputKey, nodesById, projectId, providerModelDisplayNames, startedJobNodeIds]);

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

  const selectedTextNoteTargets = useMemo(() => {
    if (!selectedNodeIsTextNote || !selectedNode) {
      return [];
    }

    return canvasDoc.workflow.nodes.filter(
      (node) => node.kind === "model" && node.promptSourceNodeId === selectedNode.id
    );
  }, [canvasDoc.workflow.nodes, selectedNode, selectedNodeIsTextNote]);

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
    const nodesRaw = Array.isArray((raw.workflow as Record<string, unknown> | undefined)?.nodes)
      ? (((raw.workflow as Record<string, unknown>).nodes as unknown[]) || [])
      : [];

    const nodes = nodesRaw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((node, index) => normalizeNode(node, index));

    const nextDoc: CanvasDocument = {
      canvasViewport: {
        x: typeof viewportRaw.x === "number" ? viewportRaw.x : defaultCanvasDocument.canvasViewport.x,
        y: typeof viewportRaw.y === "number" ? viewportRaw.y : defaultCanvasDocument.canvasViewport.y,
        zoom:
          typeof viewportRaw.zoom === "number"
            ? viewportRaw.zoom
            : defaultCanvasDocument.canvasViewport.zoom,
      },
      workflow: {
        nodes,
      },
    };

    canvasDocRef.current = nextDoc;
    setCanvasDoc(nextDoc);
    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(selectedNodeIdsRef.current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
    setOpenBottomBarPopoverId(null);
    resetCanvasHistory();

    hasLoadedCanvasRef.current = true;

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
    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(nodeId ? [nodeId] : []);
    setOpenBottomBarPopoverId(null);
  }, [commitPendingCoalescedHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    commitPendingCoalescedHistory();
    setTrackedSelectedConnection(null);
    setTrackedSelectedNodeIds(
      selectedNodeIdsRef.current.includes(nodeId)
        ? selectedNodeIdsRef.current.filter((id) => id !== nodeId)
        : [...selectedNodeIdsRef.current, nodeId]
    );
    setOpenBottomBarPopoverId(null);
  }, [commitPendingCoalescedHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const addNodesToSelection = useCallback((nodeIds: string[]) => {
    commitPendingCoalescedHistory();
    setTrackedSelectedConnection(null);
    const seen = new Set(selectedNodeIdsRef.current);
    const merged = [...selectedNodeIdsRef.current];
    for (const nodeId of nodeIds) {
      if (seen.has(nodeId)) {
        continue;
      }
      seen.add(nodeId);
      merged.push(nodeId);
    }
    setTrackedSelectedNodeIds(merged);
    setOpenBottomBarPopoverId(null);
  }, [commitPendingCoalescedHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]);

  const selectCanvasConnection = useCallback(
    (nextConnection: CanvasConnection | null) => {
      commitPendingCoalescedHistory();
      setTrackedSelectedConnection(nextConnection);
      if (nextConnection) {
        setTrackedSelectedNodeIds([]);
      }
      setOpenBottomBarPopoverId(null);
    },
    [commitPendingCoalescedHistory, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const buildNodeRunRequest = useCallback(
    (node: WorkflowNode) => {
      const model = providers.find(
        (providerModel) => providerModel.providerId === node.providerId && providerModel.modelId === node.modelId
      );
      const isOpenAiTextModel = isRunnableOpenAiTextModel(model?.providerId, model?.modelId);
      const promptSourceNode = node.promptSourceNodeId ? nodesById[node.promptSourceNodeId] || null : null;
      const prompt = node.promptSourceNodeId ? (promptSourceNode?.prompt || "") : node.prompt;
      const maxInputImages = model?.capabilities.maxInputImages || 0;
      const acceptedMimeTypes = new Set(model?.capabilities.acceptedInputMimeTypes || []);
      const connectedImageRefs = (isOpenAiTextModel ? [] : node.upstreamNodeIds)
        .map((nodeId) => nodesById[nodeId] || null)
        .map((inputNode) => (inputNode ? resolveNodeImageAsset(inputNode) : null))
        .filter((assetRef): assetRef is NonNullable<ReturnType<typeof resolveNodeImageAsset>> => Boolean(assetRef));

      const inputImageAssetIds = isOpenAiTextModel
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
      const resolvedTextSettings = isOpenAiTextModel
        ? resolveOpenAiTextSettings(effectiveSettings, model?.modelId)
        : null;
      const outputCount = isRunnableOpenAiImageModel(model?.providerId, model?.modelId)
        ? resolveOpenAiImageSettings(effectiveSettings, executionMode, model?.modelId).outputCount
        : 1;

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
      } else if (isOpenAiTextModel && (node.upstreamNodeIds.length > 0 || node.upstreamAssetIds.length > 0)) {
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
        } else if (isOpenAiTextModel) {
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

      const debugRequest = isOpenAiTextModel
        ? buildOpenAiTextDebugRequest({
            modelId: node.modelId,
            prompt: requestPayload.nodePayload.prompt,
            rawSettings: requestPayload.nodePayload.settings,
          })
        : isRunnableOpenAiImageModel(node.providerId, node.modelId)
        ? buildOpenAiImageDebugRequest({
            modelId: node.modelId,
            prompt: requestPayload.nodePayload.prompt,
            executionMode,
            rawSettings: requestPayload.nodePayload.settings,
            inputImageAssetIds,
          })
        : isRunnableTopazGigapixelModel(node.providerId, node.modelId)
          ? buildTopazGigapixelDebugRequest({
              modelId: node.modelId,
              prompt: requestPayload.nodePayload.prompt,
              rawSettings: requestPayload.nodePayload.settings,
              inputImageAssetIds,
              inputAssets: connectedImageRefs.map((assetRef) => ({
                assetId: assetRef.assetId,
                mimeType: assetRef.mimeType,
              })),
            })
          : null;

      return {
        requestPayload,
        disabledReason,
        readyMessage,
        endpoint:
          debugRequest?.endpoint ||
          (isOpenAiTextModel
            ? "client.responses.create"
            : executionMode === "generate"
              ? "client.images.generate"
              : "client.images.edit"),
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

  useEffect(() => {
    setIsLoading(true);
    hasLoadedCanvasRef.current = false;
    pendingCanvasSaveRef.current = null;

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
    if (jobs.length === 0) {
      return;
    }

    const prev = canvasDocRef.current;
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const workingNodes = [...prev.workflow.nodes];
    let didChange = false;

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

      existingGeneratedTextCountByModelNodeId.set(
        generatedSettings.sourceModelNodeId,
        (existingGeneratedTextCountByModelNodeId.get(generatedSettings.sourceModelNodeId) || 0) + 1
      );
    }

    const insertedGeneratedImageCountByModelNodeId = new Map<string, number>();
    const insertedGeneratedTextCountByModelNodeId = new Map<string, number>();

    for (const job of jobs) {
      const sourceNodeId = job.nodeRunPayload?.nodeId;
      if (!sourceNodeId) {
        continue;
      }

      const modelNode = workingNodes.find((node) => node.id === sourceNodeId && node.kind === "model");
      if (!modelNode) {
        continue;
      }

      if (job.nodeRunPayload?.outputType === "image") {
        const expectedOutputCount = getExpectedGeneratedOutputCount(job);
        if (expectedOutputCount <= 0) {
          continue;
        }

        const jobNodes = workingNodes.filter(
          (node) =>
            getNodeSourceJobId(node) === job.id &&
            (typeof node.settings.sourceModelNodeId === "string" || node.upstreamNodeIds.includes(sourceNodeId))
        );
        for (let outputIndex = 0; outputIndex < expectedOutputCount; outputIndex += 1) {
          const hasIndexedNode = jobNodes.some((node) => getNodeSourceOutputIndex(node) === outputIndex);
          const hasLegacyPrimaryNode =
            outputIndex === 0 && jobNodes.some((node) => getNodeSourceOutputIndex(node) === null);

          if (hasIndexedNode || hasLegacyPrimaryNode) {
            continue;
          }

          const visualIndex =
            (existingGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) +
            (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0);
          const outputNode = createGeneratedOutputNode(modelNode, job, sourceNodeId, outputIndex, visualIndex);

          workingNodes.push(outputNode);
          insertedGeneratedImageCountByModelNodeId.set(
            sourceNodeId,
            (insertedGeneratedImageCountByModelNodeId.get(sourceNodeId) || 0) + 1
          );
          didChange = true;
        }
        continue;
      }

      if (job.nodeRunPayload?.outputType !== "text") {
        continue;
      }

      const textOutputTarget = getTextOutputTargetFromSettings(job.nodeRunPayload?.settings);
      const generatedNodeDescriptors = job.generatedNodeDescriptors || [];
      const jobNodes = workingNodes.filter(
        (node) => getNodeSourceJobId(node) === job.id && Boolean(getGeneratedModelNodeSource(node.settings))
      );
      const ensuredDescriptorKeys = new Set(
        jobNodes.map((node) =>
          getGeneratedNodeDescriptorKey({
            sourceJobId: job.id,
            outputIndex: getNodeSourceOutputIndex(node) ?? 0,
            descriptorIndex: getNodeSourceDescriptorIndex(node),
          })
        )
      );

      const descriptorsToEnsure =
        textOutputTarget === "smart"
          ? generatedNodeDescriptors
          : generatedNodeDescriptors.length > 0
            ? generatedNodeDescriptors.slice(0, 1)
            : job.state === "queued" || job.state === "running" || job.state === "failed"
              ? [null]
              : [];

      if (getExpectedGeneratedTextNodeCount(job) <= 0) {
        continue;
      }

      for (const descriptor of descriptorsToEnsure) {
        const descriptorKey = descriptor
          ? getGeneratedNodeDescriptorKey(descriptor)
          : getGeneratedNodeDescriptorKey({
              sourceJobId: job.id,
              outputIndex: 0,
              descriptorIndex: 0,
            });
        if (ensuredDescriptorKeys.has(descriptorKey)) {
          continue;
        }

        const visualIndex =
          (existingGeneratedTextCountByModelNodeId.get(sourceNodeId) || 0) +
          (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId) || 0);
        const outputNode = descriptor
          ? createGeneratedModelNode({
              id: uid(),
              providerId: modelNode.providerId,
              modelId: modelNode.modelId,
              modelNodeId: sourceNodeId,
              label: descriptor.label || getGeneratedDescriptorDefaultLabel(descriptor.kind, visualIndex),
              position: buildGeneratedNodePosition({
                modelNode,
                visualIndex,
                baseOffsetX: generatedTextNodeOffsetX,
                offsetY: generatedTextNodeOffsetY,
              }),
              processingState:
                job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null,
              descriptor,
              connectToSourceModel: textOutputTarget !== "smart",
            })
          : createGeneratedModelPlaceholderNode(
              modelNode,
              job,
              sourceNodeId,
              textOutputTarget === "list" ? "list" : textOutputTarget === "template" ? "template" : "note",
              visualIndex
            );

        workingNodes.push(outputNode);
        insertedGeneratedTextCountByModelNodeId.set(
          sourceNodeId,
          (insertedGeneratedTextCountByModelNodeId.get(sourceNodeId) || 0) + 1
        );
        ensuredDescriptorKeys.add(descriptorKey);
        didChange = true;
      }
    }

    const updatedNodes = workingNodes.map((node) => {
        if (isGeneratedAssetNode(node)) {
          const sourceJobId = getNodeSourceJobId(node);
          if (!sourceJobId) {
            return node;
          }

          const job = jobById.get(sourceJobId);
          if (!job) {
            return node;
          }

          const sourceOutputIndex = getNodeSourceOutputIndex(node);
          const matchingImageAsset = findMatchingGeneratedImageAsset(job, sourceOutputIndex);

          const nextProcessingState =
            job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null;
          const nextNode: WorkflowNode = {
            ...node,
            providerId: job.providerId as WorkflowNode["providerId"],
            modelId: job.modelId,
            sourceJobId,
            sourceOutputIndex,
            processingState: nextProcessingState,
            sourceAssetId: matchingImageAsset?.id || node.sourceAssetId,
            sourceAssetMimeType: matchingImageAsset?.mimeType || node.sourceAssetMimeType,
            settings: {
              ...node.settings,
              source: "generated",
              sourceJobId,
              outputIndex: sourceOutputIndex,
              sourceModelNodeId:
                typeof node.settings.sourceModelNodeId === "string"
                  ? node.settings.sourceModelNodeId
                  : job.nodeRunPayload?.nodeId || null,
            },
          };

          if (JSON.stringify(nextNode) === JSON.stringify(node)) {
            return node;
          }

          didChange = true;
          return nextNode;
        }

        const generatedModelSource = getGeneratedModelNodeSource(node.settings);
        if (!generatedModelSource) {
          return node;
        }

        const sourceJobId = getNodeSourceJobId(node);
        if (!sourceJobId) {
          return node;
        }

        const job = jobById.get(sourceJobId);
        if (!job) {
          return node;
        }

        const nextProcessingState =
          job.state === "queued" || job.state === "running" || job.state === "failed" ? job.state : null;
        const matchingDescriptor = findMatchingGeneratedNodeDescriptor(job, node);

        if (!matchingDescriptor) {
          const nextNode =
            nextProcessingState === node.processingState
              ? node
              : {
                  ...node,
                  processingState: nextProcessingState,
                };
          if (JSON.stringify(nextNode) === JSON.stringify(node)) {
            return node;
          }
          didChange = true;
          return nextNode;
        }

        const allowContentHydration =
          node.processingState !== null ||
          node.kind !== matchingDescriptor.kind ||
          getNodeSourceDescriptorIndex(node) !== matchingDescriptor.descriptorIndex;
        const nextNode = applyGeneratedDescriptorToNode(node, {
          providerId: job.providerId as WorkflowNode["providerId"],
          modelId: job.modelId,
          processingState: nextProcessingState,
          descriptor: matchingDescriptor,
          allowContentHydration,
          connectToSourceModel: getTextOutputTargetFromSettings(job.nodeRunPayload?.settings) !== "smart",
        });

        if (JSON.stringify(nextNode) === JSON.stringify(node)) {
          return node;
        }

        didChange = true;
        return nextNode;
    });

    if (!didChange) {
      return;
    }

    const nextDoc: CanvasDocument = {
      ...prev,
      workflow: {
        nodes: updatedNodes,
      },
    };

    applyCanvasDocWithoutHistory(nextDoc);
  }, [applyCanvasDocWithoutHistory, jobs]);

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
    (position?: { x: number; y: number }, options?: { connectFromNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const outputType = resolveOutputType(undefined, getModelSupportedOutputs(defaultProvider));
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const connectFromNode = options?.connectFromNodeId
          ? prev.workflow.nodes.find((candidate) => candidate.id === options.connectFromNodeId) || null
          : null;
        const node: WorkflowNode = {
          id: uid(),
          label: `Node ${prev.workflow.nodes.length + 1}`,
          kind: "model",
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: nodeTypeFromOutput(outputType),
          outputType,
          prompt: "",
          settings: getModelDefaultSettings(defaultProvider),
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
      setInsertMenu(null);
      setOpenBottomBarPopoverId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const addTextNote = useCallback(
    (position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const node: WorkflowNode = {
          id: uid(),
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
      setInsertMenu(null);
      setOpenBottomBarPopoverId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const addListNode = useCallback(
    (position?: { x: number; y: number }, options?: { connectToTemplateNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const node: WorkflowNode = {
          id: uid(),
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
      setInsertMenu(null);
      setOpenBottomBarPopoverId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const addTextTemplateNode = useCallback(
    (position?: { x: number; y: number }, options?: { connectFromListNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const nextPosition = nextCanvasNodePosition(prev.workflow.nodes.length, position);
        const connectFromNode =
          options?.connectFromListNodeId
            ? prev.workflow.nodes.find((candidate) => candidate.id === options.connectFromListNodeId && candidate.kind === "list") || null
            : null;
        const node: WorkflowNode = {
          id: uid(),
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
      setInsertMenu(null);
      setOpenBottomBarPopoverId(null);
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
    setOpenBottomBarPopoverId(null);
    setAssetPicker(null);
    setInsertMenu({
      clientX: anchor.clientX,
      clientY: anchor.clientY,
      worldX: anchor.worldX,
      worldY: anchor.worldY,
      mode: "canvas",
    });
  }, [commitPendingCoalescedHistory, getCanvasViewportCenterAnchor, setTrackedSelectedConnection]);

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
    setOpenBottomBarPopoverId(null);
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
    setOpenBottomBarPopoverId(null);
  }, [applyCanvasHistoryState, captureCanvasHistoryState, commitPendingCoalescedHistory, syncHistoryStacks]);

  const openPrimaryEditorForNode = useCallback(
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
      setOpenBottomBarPopoverId(
        resolvePrimaryCanvasEditorId(node, {
          hasSourceJob: Boolean(getNodeSourceJobId(node)),
        })
      );
    },
    [commitPendingCoalescedHistory, nodesById, setTrackedSelectedConnection, setTrackedSelectedNodeIds]
  );

  const openPrimaryEditorForSelection = useCallback(() => {
    if (selectedNodeIdsRef.current.length !== 1) {
      return;
    }
    openPrimaryEditorForNode(selectedNodeIdsRef.current[0]!);
  }, [openPrimaryEditorForNode]);

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

  const providerOptions = useMemo(
    () =>
      Object.entries(groupedProviders).map(([providerId, providerModels]) => ({
        value: providerId,
        label: providerId,
        description: `${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`,
      })),
    [groupedProviders]
  );

  const modelOptions = useMemo(
    () =>
      selectedNode ? (groupedProviders[selectedNode.providerId] || []).map((model) => ({
        value: model.modelId,
        label: model.displayName,
        statusLabel: model.capabilities.availability === "ready" ? undefined : "Coming soon",
        description: model.modelId,
      })) : [],
    [groupedProviders, selectedNode]
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

  const handleSelectedNodeProviderChange = useCallback(
    (providerId: WorkflowNode["providerId"]) => {
      if (!selectedNode || !selectedNodeIsModel) {
        return;
      }

      const model = (groupedProviders[providerId] || [])[0];
      const supportedOutputs = getModelSupportedOutputs(model);
      const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);
      const nextUpstreamNodeIds = isRunnableOpenAiTextModel(model?.providerId, model?.modelId)
        ? []
        : selectedNode.upstreamNodeIds;
      const nextExecutionMode = getExecutionModeForModel(model, nextUpstreamNodeIds);

      updateNode(
        selectedNode.id,
        {
          providerId,
          modelId: model?.modelId || "",
          outputType,
          nodeType: nodeTypeFromOutput(outputType),
          upstreamNodeIds: nextUpstreamNodeIds,
          upstreamAssetIds: isRunnableOpenAiTextModel(model?.providerId, model?.modelId)
            ? []
            : buildAssetRefsFromNodes(nextUpstreamNodeIds, canvasDoc.workflow.nodes),
          settings: resolveModelSettings(model, selectedNode.settings, nextExecutionMode),
        },
        {
          historyMode: "immediate",
        }
      );
    },
    [canvasDoc.workflow.nodes, getExecutionModeForModel, groupedProviders, selectedNode, selectedNodeIsModel, updateNode]
  );

  const handleSelectedNodeModelChange = useCallback(
    (modelId: string) => {
      if (!selectedNode || !selectedNodeIsModel) {
        return;
      }

      const model = (groupedProviders[selectedNode.providerId] || []).find(
        (providerModel) => providerModel.modelId === modelId
      );
      const supportedOutputs = getModelSupportedOutputs(model);
      const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);
      const nextUpstreamNodeIds = isRunnableOpenAiTextModel(model?.providerId, model?.modelId)
        ? []
        : selectedNode.upstreamNodeIds;
      const nextExecutionMode = getExecutionModeForModel(model, nextUpstreamNodeIds);

      updateNode(
        selectedNode.id,
        {
          modelId,
          outputType,
          nodeType: nodeTypeFromOutput(outputType),
          upstreamNodeIds: nextUpstreamNodeIds,
          upstreamAssetIds: isRunnableOpenAiTextModel(model?.providerId, model?.modelId)
            ? []
            : buildAssetRefsFromNodes(nextUpstreamNodeIds, canvasDoc.workflow.nodes),
          settings: resolveModelSettings(model, selectedNode.settings, nextExecutionMode),
        },
        {
          historyMode: "immediate",
        }
      );
    },
    [canvasDoc.workflow.nodes, getExecutionModeForModel, groupedProviders, selectedNode, selectedNodeIsModel, updateNode]
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

        const defaultProvider = fallbackProviderModel(providers);
        runUserCanvasMutation((currentState) => {
          const prev = currentState.canvasDoc;
          const baseX = position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
          const baseY = position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

          const sourceNodes = uploaded.map(({ file, asset }, index) => {
            const outputType = outputTypeFromAssetType(asset.type);
            return {
              id: uid(),
              label: normalizeAssetNodeLabel(file.name, index),
              kind: "asset-source" as const,
              providerId: defaultProvider.providerId,
              modelId: defaultProvider.modelId,
              nodeType: "transform" as const,
              outputType,
              prompt: "",
              settings: { source: "upload" },
              sourceAssetId: asset.id,
              sourceAssetMimeType: asset.mimeType,
              sourceJobId: null,
              sourceOutputIndex: null,
              processingState: null,
              promptSourceNodeId: null,
              upstreamNodeIds: [],
              upstreamAssetIds: [],
              x: Math.round(baseX + index * 34),
              y: Math.round(baseY + index * 26),
            };
          });

          const sourceNodeIds = sourceNodes.map((node) => node.id);
          const nextNodes = prev.workflow.nodes.map((node) => {
            if (node.id !== options?.connectToModelNodeId || node.kind !== "model") {
              return node;
            }

            if (isRunnableOpenAiTextModel(node.providerId, node.modelId)) {
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
        setInsertMenu(null);
        setOpenBottomBarPopoverId(null);
      } catch (error) {
        console.error(error);
      } finally {
        pendingUploadAnchorRef.current = null;
      }
    },
    [projectId, providers, runUserCanvasMutation]
  );

  const addImportedAssetsToCanvas = useCallback(
    (
      imported: Asset[],
      position?: { x: number; y: number },
      options?: { connectToModelNodeId?: string }
    ) => {
      if (imported.length === 0) {
        return;
      }

      const defaultProvider = fallbackProviderModel(providers);
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const baseX = position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
        const baseY = position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

        const sourceNodes = imported.map((asset, index) => {
          const outputType = outputTypeFromAssetType(asset.type);
          return {
            id: uid(),
            label: getImportedAssetNodeLabel(asset, index),
            kind: "asset-source" as const,
            providerId: defaultProvider.providerId,
            modelId: defaultProvider.modelId,
            nodeType: "transform" as const,
            outputType,
            prompt: "",
            settings: { source: "upload" },
            sourceAssetId: asset.id,
            sourceAssetMimeType: asset.mimeType,
            sourceJobId: null,
            sourceOutputIndex: null,
            processingState: null,
            promptSourceNodeId: null,
            upstreamNodeIds: [],
            upstreamAssetIds: [],
            x: Math.round(baseX + index * 34),
            y: Math.round(baseY + index * 26),
          };
        });

        const sourceNodeIds = sourceNodes.map((node) => node.id);
        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== options?.connectToModelNodeId || node.kind !== "model") {
            return node;
          }

          if (isRunnableOpenAiTextModel(node.providerId, node.modelId)) {
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
      setInsertMenu(null);
      setOpenBottomBarPopoverId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const spawnAssetPointerNodes = useCallback(
    (assets: Asset[], position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      if (assets.length === 0) {
        return;
      }

      const defaultProvider = fallbackProviderModel(providers);
      runUserCanvasMutation((currentState) => {
        const prev = currentState.canvasDoc;
        const baseX = position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
        const baseY = position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

        const sourceNodes = assets.map((asset, index) => {
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
              source: asset.origin || (asset.jobId ? "generated" : "upload"),
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
          };
        });

        const sourceNodeIds = sourceNodes.map((node) => node.id);
        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== options?.connectToModelNodeId || node.kind !== "model") {
            return node;
          }

          if (isRunnableOpenAiTextModel(node.providerId, node.modelId)) {
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
      setOpenBottomBarPopoverId(null);
    },
    [providers, runUserCanvasMutation]
  );

  const handleCanvasInsertRequest = useCallback(
    (request: CanvasInsertRequest) => {
      commitPendingCoalescedHistory();
      setTrackedSelectedConnection(null);
      setOpenBottomBarPopoverId(null);

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
        const sourceNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId);
        const targetNode = prev.workflow.nodes.find((node) => node.id === targetNodeId);
        if (!sourceNode || !targetNode) {
          return null;
        }

        if (targetNode.kind === "text-note") {
          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  upstreamNodeIds: [sourceNodeId],
                  upstreamAssetIds: [`node:${sourceNodeId}`],
                }
              : node
          );

          return {
            canvasDoc: {
              ...prev,
              workflow: {
                nodes: nextNodes,
              },
            },
          };
        }

        if (sourceNode.kind === "text-note") {
          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  promptSourceNodeId: sourceNodeId,
                }
              : node
          );

          return {
            canvasDoc: {
              ...prev,
              workflow: {
                nodes: nextNodes,
              },
            },
          };
        }

        if (sourceNode.kind === "list") {
          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  upstreamNodeIds: [sourceNodeId],
                  upstreamAssetIds: buildAssetRefsFromNodes([sourceNodeId], prev.workflow.nodes),
                }
              : node
          );

          return {
            canvasDoc: {
              ...prev,
              workflow: {
                nodes: nextNodes,
              },
            },
          };
        }

        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== targetNodeId) {
            return node;
          }
          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, sourceNodeId])];
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
        addModelNode(position);
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

      addTextTemplateNode(position);
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

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.length === 0) {
      return;
    }
    removeNodes(selectedNodeIds);
  }, [removeNodes, selectedNodeIds]);

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
    (nextViewport: CanvasDocument["canvasViewport"]) => {
      applyCanvasDocWithoutHistory({
        ...canvasDocRef.current,
        canvasViewport: nextViewport,
      });
    },
    [applyCanvasDocWithoutHistory]
  );

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

      const generatedCount = prev.workflow.nodes.filter(
        (node) =>
          isGeneratedAssetNode(node) &&
          (node.settings.sourceModelNodeId === sourceNodeId || node.upstreamNodeIds.includes(sourceNodeId))
      ).length;

      const outputNodes: WorkflowNode[] = Array.from({ length: outputCount }, (_, outputOffset) => {
        const outputIndex = outputOffset;
        const visualIndex = generatedCount + outputOffset;
        return {
          id: uid(),
          label: getGeneratedNodeLabel(visualIndex),
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
          processingState: "queued",
          promptSourceNodeId: null,
          upstreamNodeIds: [sourceNodeId],
          upstreamAssetIds: [`node:${sourceNodeId}`],
          x: Math.round(modelNode.x + generatedNodeBaseOffsetX + Math.floor(visualIndex / 4) * generatedNodeColumnOffsetX),
          y: Math.round(modelNode.y + (visualIndex % 4) * generatedNodeOffsetY),
        };
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
              getGeneratedModelNodeCount(prev.workflow.nodes, sourceNodeId)
            ),
          ],
        },
      });
    },
    [applyCanvasDocWithoutHistory]
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

  const addSelectedListRow = useCallback(() => {
    if (!selectedListSettings) {
      return;
    }

    updateSelectedListSettings(
      {
        ...selectedListSettings,
        rows: [
          ...selectedListSettings.rows,
          {
            id: uid(),
            values: selectedListSettings.columns.reduce<Record<string, string>>((acc, column) => {
              acc[column.id] = "";
              return acc;
            }, {}),
          },
        ],
      },
      {
        historyMode: "immediate",
      }
    );
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

  const openImportDialog = useCallback(async () => {
    const imported = await importProjectAssets(projectId);
    addImportedAssetsToCanvas(
      imported,
      pendingUploadAnchorRef.current
        ? { x: pendingUploadAnchorRef.current.x, y: pendingUploadAnchorRef.current.y }
        : undefined,
      pendingUploadAnchorRef.current?.connectToModelNodeId
        ? { connectToModelNodeId: pendingUploadAnchorRef.current.connectToModelNodeId }
        : undefined
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

  const apiCallPreviewPayload = useMemo(() => {
    if (!selectedNodeRunPreview) {
      return null;
    }

    if (selectedNodeRunPreview.debugRequest) {
      return selectedNodeRunPreview.debugRequest;
    }

    return {
      endpoint: selectedNodeRunPreview.endpoint,
      request: selectedNodeRunPreview.requestPayload,
    };
  }, [selectedNodeRunPreview]);

  const openQueueInspect = useCallback(
    (jobId: string) => {
      router.push(`/projects/${projectId}/queue?inspectJobId=${jobId}`);
    },
    [projectId, router]
  );

  const insertMenuTargetNode =
    insertMenu?.mode === "model-input" && insertMenu.connectToNodeId ? nodesById[insertMenu.connectToNodeId] || null : null;
  const insertMenuTargetIsOpenAiTextModel =
    insertMenuTargetNode?.kind === "model" &&
    isRunnableOpenAiTextModel(insertMenuTargetNode.providerId, insertMenuTargetNode.modelId);
  const insertMenuAllowsAssetInputs = insertMenu
    ? insertMenu.mode === "canvas" || (insertMenu.mode === "model-input" && !insertMenuTargetIsOpenAiTextModel)
    : false;
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
        getState: () => {
          selectedNodeIds: string[];
          openPopoverId: CanvasBottomBarPopoverId | null;
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
        setOpenBottomBarPopoverId(null);
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
      getState: () => ({
        selectedNodeIds: [...selectedNodeIdsRef.current],
        openPopoverId: openBottomBarPopoverId,
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
    openBottomBarPopoverId,
    openPrimaryEditorForNode,
    setTrackedSelectedConnection,
    setTrackedSelectedNodeIds,
  ]);

  return (
    <WorkspaceShell
      projectId={projectId}
      view="canvas"
      jobs={jobs}
      showQueuePill
      queuePillPlacement="top-right"
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
              onUpdateTextNote={(nodeId, prompt) =>
                updateNode(
                  nodeId,
                  { prompt },
                  {
                    historyMode: "coalesced",
                    historyKey: `node:${nodeId}:prompt`,
                  }
                )
              }
              onRequestInsertMenu={handleCanvasInsertRequest}
              onDropFiles={(files, position) => {
                uploadFilesToCanvas(files, position).catch(console.error);
              }}
              onViewportChange={updateViewport}
              onCommitNodePositions={commitNodePositions}
              onConnectNodes={connectNodes}
              onSelectConnection={selectCanvasConnection}
              onNodeDoubleClick={openPrimaryEditorForNode}
            />
          )}
        </div>

        {insertMenu ? (
          <div
            ref={insertMenuRef}
            className={styles.insertMenu}
            style={{
              left: insertMenu.clientX,
              top: insertMenu.clientY,
            }}
          >
            <div className={styles.insertMenuTitle}>
              {insertMenu.mode === "model-input"
                ? "Add Model Input"
                : insertMenu.mode === "template-input"
                  ? "Add Template Input"
                  : "Add To Canvas"}
            </div>
            {insertMenu.mode === "canvas" ? (
              <button type="button" onClick={() => addModelNode({ x: insertMenu.worldX, y: insertMenu.worldY })}>
                Add Model Node
              </button>
            ) : null}
            {insertMenu.mode !== "template-input" ? (
              <button
                type="button"
                onClick={() =>
                  addTextNote(
                    { x: insertMenu.worldX, y: insertMenu.worldY },
                    insertMenu.mode === "model-input" && insertMenu.connectToNodeId
                      ? { connectToModelNodeId: insertMenu.connectToNodeId }
                      : undefined
                  )
                }
              >
                Add Text Note
              </button>
            ) : null}
            {insertMenu.mode !== "model-input" ? (
              <button
                type="button"
                onClick={() =>
                  addListNode(
                    { x: insertMenu.worldX, y: insertMenu.worldY },
                    insertMenu.mode === "template-input" && insertMenu.connectToNodeId
                      ? { connectToTemplateNodeId: insertMenu.connectToNodeId }
                      : undefined
                  )
                }
              >
                Add List
              </button>
            ) : null}
            {insertMenu.mode === "canvas" ? (
              <button
                type="button"
                onClick={() => addTextTemplateNode({ x: insertMenu.worldX, y: insertMenu.worldY })}
              >
                Add Text Template
              </button>
            ) : null}
            {insertMenuAllowsAssetInputs ? (
              <button
                type="button"
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
            {insertMenuAllowsAssetInputs ? (
              <button
                type="button"
                onClick={() => {
                  setInsertMenu(null);
                  setAssetPicker({
                    origin: "generated",
                    worldX: insertMenu.worldX,
                    worldY: insertMenu.worldY,
                    connectToModelNodeId:
                      insertMenu.mode === "model-input" ? insertMenu.connectToNodeId : undefined,
                  });
                }}
              >
                Add Generated Asset
              </button>
            ) : null}
            {insertMenuAllowsAssetInputs ? (
              <button
                type="button"
                onClick={() => {
                  setInsertMenu(null);
                  setAssetPicker({
                    origin: "uploaded",
                    worldX: insertMenu.worldX,
                    worldY: insertMenu.worldY,
                    connectToModelNodeId:
                      insertMenu.mode === "model-input" ? insertMenu.connectToNodeId : undefined,
                  });
                }}
              >
                Add Uploaded Asset
              </button>
            ) : null}
          </div>
        ) : null}

        {assetPicker ? (
          <div className={styles.assetPickerBackdrop}>
            <section ref={assetPickerRef} className={styles.assetPickerModal}>
              <header className={styles.assetPickerHeader}>
                <div>
                  <strong>{assetPicker.origin === "generated" ? "Add Generated Asset" : "Add Uploaded Asset"}</strong>
                  <span>{assetPicker.origin === "generated" ? "Spawn pointer nodes to previous generations." : "Spawn pointer nodes to previous uploads."}</span>
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
                        <span>{asset.origin === "generated" ? `${asset.job?.providerId || "generated"} / ${asset.job?.modelId || "unknown"}` : "Uploaded asset"}</span>
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

        <CanvasBottomBar
          projectId={projectId}
          selectedNodeIds={selectedNodeIds}
          selectedNode={selectedNode}
          selectedNodeIsModel={selectedNodeIsModel}
          selectedNodeIsTextNote={selectedNodeIsTextNote}
          selectedNodeIsList={Boolean(selectedNodeIsList)}
          selectedNodeIsTextTemplate={Boolean(selectedNodeIsTextTemplate)}
          selectedNodeIsAssetSource={selectedNodeIsAssetSource}
          selectedNodeIsGeneratedAsset={selectedNodeIsGeneratedAsset}
          selectedNodeIsGeneratedTextNote={selectedNodeIsGeneratedTextNote}
          selectedNodeIsGeneratedModelNode={selectedNodeIsGeneratedModelNode}
          selectedModel={selectedModel}
          selectedGeneratedSourceJob={selectedGeneratedSourceJob}
          selectedNodeSourceJobId={selectedNodeSourceJobId}
          selectedNodeResolvedSettings={selectedNodeResolvedSettings}
          selectedCoreParameters={selectedCoreParameters}
          selectedAdvancedParameters={selectedAdvancedParameters}
          selectedTextNoteTargets={selectedTextNoteTargets}
          selectedInputNodes={selectedInputNodes}
          selectedPromptSourceNode={selectedPromptSourceNode}
          selectedNodeRunPreview={selectedNodeRunPreview}
          selectedListSettings={selectedListSettings}
          selectedTemplatePreview={selectedTemplatePreview}
          selectedTemplateListNode={selectedTemplateListNode}
          selectedTemplateGeneratedTextSettings={selectedTemplateGeneratedTextSettings}
          selectedModelGeneratedTextSettings={selectedModelGeneratedTextSettings}
          selectedGeneratedTextTemplateNode={selectedGeneratedTextTemplateNode}
          selectedGeneratedTextListNode={selectedGeneratedTextListNode}
          selectedGeneratedTextSourceModelNode={selectedGeneratedTextSourceModelNode}
          selectedImageAssetIds={selectedImageAssetIds}
          selectedSingleImageAssetId={selectedSingleImageAssetId}
          providerOptions={providerOptions}
          modelOptions={modelOptions}
          apiCallPreviewPayload={apiCallPreviewPayload}
          onLabelChange={handleSelectedNodeLabelChange}
          onPromptChange={handleSelectedNodePromptChange}
          onProviderChange={handleSelectedNodeProviderChange}
          onModelChange={handleSelectedNodeModelChange}
          onParameterChange={updateSelectedModelParameter}
          onUpdateListColumnLabel={updateSelectedListColumnLabel}
          onUpdateListCell={updateSelectedListCell}
          onAddListColumn={addSelectedListColumn}
          onRemoveListColumn={removeSelectedListColumn}
          onAddListRow={addSelectedListRow}
          onRemoveListRow={removeSelectedListRow}
          onRun={() => {
            if (selectedNode) {
              runNode(selectedNode).catch(console.error);
            }
          }}
          onDeleteSelection={handleDeleteSelected}
          onClearInputs={handleClearSelectedInputs}
          onOpenAssetViewer={openAssetViewer}
          onDownloadAssets={downloadAssets}
          onOpenCompare={openCompare}
          onOpenQueueInspect={openQueueInspect}
          openPopoverId={openBottomBarPopoverId}
          onOpenPopoverChange={setOpenBottomBarPopoverId}
          onCommitTextEdits={commitPendingCoalescedHistory}
        />
      </div>
    </WorkspaceShell>
  );
}
