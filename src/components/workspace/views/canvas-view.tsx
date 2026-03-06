"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
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
  createJobFromRequest,
  getCanvasWorkspace,
  getAssetPointers,
  getJobs,
  getProviders,
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
  getGeneratedTextNoteSettings,
  getListNodeSettings,
  isGeneratedTextNoteNode,
} from "@/lib/list-template";
import styles from "./canvas-view.module.css";

const supportedOutputOrder = ["image", "video", "text"] as const;
const generatedNodeBaseOffsetX = 328;
const generatedNodeColumnOffsetX = 40;
const generatedNodeOffsetY = 38;
const generatedTextNodeOffsetX = 320;
const generatedTextNodeOffsetY = 172;

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
type CanvasSemanticType = WorkflowNode["outputType"];
const canvasSemanticTypeOrder: CanvasSemanticType[] = ["text", "image", "video"];

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
  return `/api/projects/${projectId}/jobs/${jobId}/preview-frames/${previewFrame.id}/file?ts=${encodeURIComponent(previewFrame.createdAt)}`;
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
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: Math.round(templateNode.x + generatedTextNodeOffsetX),
    y: Math.round(templateNode.y + visualIndex * generatedTextNodeOffsetY),
  };
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

function isInputLikeElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
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

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const assetPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingUploadAnchorRef = useRef<{ x: number; y: number; connectToModelNodeId?: string } | null>(null);

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
  const selectedNodeGeneratedTextSettings = useMemo(
    () => getGeneratedTextNoteSettings(selectedNode?.settings),
    [selectedNode?.settings]
  );
  const selectedNodeIsGeneratedTextNote = Boolean(selectedNodeGeneratedTextSettings);

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
    if (!selectedNodeGeneratedTextSettings) {
      return null;
    }
    return nodesById[selectedNodeGeneratedTextSettings.sourceTemplateNodeId] || null;
  }, [nodesById, selectedNodeGeneratedTextSettings]);

  const selectedGeneratedTextListNode = useMemo(() => {
    if (!selectedNodeGeneratedTextSettings) {
      return null;
    }
    return nodesById[selectedNodeGeneratedTextSettings.sourceListNodeId] || null;
  }, [nodesById, selectedNodeGeneratedTextSettings]);

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

  const canvasNodes = useMemo(() => {
    return canvasDoc.workflow.nodes.map((node) => {
      const displayModelName = providerModelDisplayNames[`${node.providerId}:${node.modelId}`] || node.modelId;
      const inputSemanticTypes = sortSemanticTypes([
        ...(node.kind === "model" && node.promptSourceNodeId ? (["text"] as CanvasSemanticType[]) : []),
        ...node.upstreamNodeIds
          .map((nodeId) => nodesById[nodeId] || null)
          .filter((inputNode): inputNode is WorkflowNode => Boolean(inputNode))
          .map((inputNode) => inputNode.outputType),
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
          outputSemanticType: node.outputType,
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
          outputSemanticType: node.outputType,
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
        outputSemanticType: node.outputType,
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

    const hasConnectedImageInputs = selectedNode.upstreamNodeIds.some((nodeId) => {
      const inputNode = nodesById[nodeId];
      const imageAsset = resolveNodeImageAsset(inputNode);
      return Boolean(imageAsset);
    });

    return hasConnectedImageInputs ? ("edit" as const) : ("generate" as const);
  }, [nodesById, resolveNodeImageAsset, selectedNode, selectedNodeIsModel]);

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

    setCanvasDoc({
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
    });

    setSelectedNodeIds((current) => current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
  }, [projectId]);

  const fetchJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

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

  const selectSingleNode = useCallback((nodeId: string | null) => {
    setSelectedConnection(null);
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedConnection(null);
    setSelectedNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      }
      return [...prev, nodeId];
    });
  }, []);

  const addNodesToSelection = useCallback((nodeIds: string[]) => {
    setSelectedConnection(null);
    setSelectedNodeIds((prev) => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);
        merged.push(nodeId);
      }
      return merged;
    });
  }, []);

  const buildNodeRunRequest = useCallback(
    (node: WorkflowNode) => {
      const model = providers.find(
        (providerModel) => providerModel.providerId === node.providerId && providerModel.modelId === node.modelId
      );
      const promptSourceNode = node.promptSourceNodeId ? nodesById[node.promptSourceNodeId] || null : null;
      const prompt = node.promptSourceNodeId ? (promptSourceNode?.prompt || "") : node.prompt;
      const maxInputImages = model?.capabilities.maxInputImages || 0;
      const acceptedMimeTypes = new Set(model?.capabilities.acceptedInputMimeTypes || []);
      const connectedImageRefs = node.upstreamNodeIds
        .map((nodeId) => nodesById[nodeId] || null)
        .map((inputNode) => (inputNode ? resolveNodeImageAsset(inputNode) : null))
        .filter((assetRef): assetRef is NonNullable<ReturnType<typeof resolveNodeImageAsset>> => Boolean(assetRef));

      const inputImageAssetIds = connectedImageRefs
        .filter((assetRef) => {
          if (acceptedMimeTypes.size === 0) {
            return true;
          }
          return Boolean(assetRef.mimeType && acceptedMimeTypes.has(assetRef.mimeType));
        })
        .map((assetRef) => assetRef.assetId)
        .filter((assetId, index, array) => array.indexOf(assetId) === index)
        .slice(0, maxInputImages || undefined);
      const executionMode = inputImageAssetIds.length > 0 ? "edit" : "generate";
      const effectiveSettings = resolveModelSettings(model, node.settings, executionMode);
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
      } else if (model.capabilities.requiresApiKeyEnv && !model.capabilities.apiKeyConfigured) {
        disabledReason = `Set ${model.capabilities.requiresApiKeyEnv} in .env.local and restart npm run dev.`;
      } else if (!model.capabilities.executionModes.includes(executionMode)) {
        disabledReason = `${model.displayName} does not support ${executionMode} mode.`;
      } else if (!requestPayload.nodePayload.prompt) {
        disabledReason = node.promptSourceNodeId
          ? "Connected text note is empty."
          : "Connect a prompt note or enter a prompt.";
      } else if (connectedImageRefs.length > 0 && requestPayload.nodePayload.inputImageAssetIds.length === 0) {
        disabledReason =
          acceptedMimeTypes.size > 0
            ? "Connected image inputs are unsupported. Use PNG, JPEG, or WebP references."
            : "Connected image inputs are unsupported for this model.";
      } else {
        readyMessage =
          executionMode === "generate"
            ? `Ready for prompt-only generation with ${outputCount} output${outputCount === 1 ? "" : "s"}.`
            : `Ready for reference-image generation from ${requestPayload.nodePayload.inputImageAssetIds.length} image input${
                requestPayload.nodePayload.inputImageAssetIds.length === 1 ? "" : "s"
              } and ${outputCount} output${outputCount === 1 ? "" : "s"}.`;
      }

      const debugRequest = isRunnableOpenAiImageModel(node.providerId, node.modelId)
        ? buildOpenAiImageDebugRequest({
            modelId: node.modelId,
            prompt: requestPayload.nodePayload.prompt,
            executionMode,
            rawSettings: requestPayload.nodePayload.settings,
            inputImageAssetIds,
          })
        : null;

      return {
        requestPayload,
        disabledReason,
        readyMessage,
        endpoint: debugRequest?.endpoint || (executionMode === "generate" ? "client.images.generate" : "client.images.edit"),
        debugRequest,
      };
    },
    [nodesById, providers, resolveNodeImageAsset]
  );

  const selectedNodeRunPreview = useMemo(() => {
    if (!selectedNode || !selectedNodeIsModel) {
      return null;
    }

    return buildNodeRunRequest(selectedNode);
  }, [buildNodeRunRequest, selectedNode, selectedNodeIsModel]);

  useEffect(() => {
    setIsLoading(true);

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
      setSelectedConnection(null);
      return;
    }

    const exists =
      selectedConnection.kind === "prompt"
        ? targetNode.promptSourceNodeId === selectedConnection.sourceNodeId
        : targetNode.upstreamNodeIds.includes(selectedConnection.sourceNodeId);

    if (!exists) {
      setSelectedConnection(null);
    }
  }, [canvasDoc.workflow.nodes, selectedConnection]);

  useEffect(() => {
    if (jobs.length === 0) {
      return;
    }

    setCanvasDoc((prev) => {
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const workingNodes = [...prev.workflow.nodes];
      let didChange = false;

      const existingGeneratedCountByModelNodeId = new Map<string, number>();
      for (const node of workingNodes) {
        if (!isGeneratedAssetNode(node)) {
          continue;
        }
        const sourceModelNodeId =
          typeof node.settings.sourceModelNodeId === "string" ? node.settings.sourceModelNodeId : null;
        if (!sourceModelNodeId) {
          continue;
        }
        existingGeneratedCountByModelNodeId.set(
          sourceModelNodeId,
          (existingGeneratedCountByModelNodeId.get(sourceModelNodeId) || 0) + 1
        );
      }

      const insertedGeneratedCountByModelNodeId = new Map<string, number>();

      for (const job of jobs) {
        const sourceNodeId = job.nodeRunPayload?.nodeId;
        if (!sourceNodeId || job.nodeRunPayload?.outputType !== "image") {
          continue;
        }

        const modelNode = workingNodes.find((node) => node.id === sourceNodeId && node.kind === "model");
        if (!modelNode) {
          continue;
        }

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
            (existingGeneratedCountByModelNodeId.get(sourceNodeId) || 0) +
            (insertedGeneratedCountByModelNodeId.get(sourceNodeId) || 0);
          const outputNode = createGeneratedOutputNode(modelNode, job, sourceNodeId, outputIndex, visualIndex);

          workingNodes.push(outputNode);
          insertedGeneratedCountByModelNodeId.set(
            sourceNodeId,
            (insertedGeneratedCountByModelNodeId.get(sourceNodeId) || 0) + 1
          );
          didChange = true;
        }
      }

      const updatedNodes = workingNodes.map((node) => {
        if (!isGeneratedAssetNode(node)) {
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
      });

      if (!didChange) {
        return prev;
      }

      const nextDoc: CanvasDocument = {
        ...prev,
        workflow: {
          nodes: updatedNodes,
        },
      };

      queueCanvasSave(nextDoc);
      return nextDoc;
    });
  }, [jobs, queueCanvasSave]);

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
    };
  }, []);

  const addModelNode = useCallback(
    (position?: { x: number; y: number }, options?: { connectFromNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
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

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setSelectedConnection(null);
        setInsertMenu(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const addTextNote = useCallback(
    (position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
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

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setSelectedConnection(null);
        setInsertMenu(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const addListNode = useCallback(
    (position?: { x: number; y: number }, options?: { connectToTemplateNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
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

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setSelectedConnection(null);
        setInsertMenu(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const addTextTemplateNode = useCallback(
    (position?: { x: number; y: number }, options?: { connectFromListNodeId?: string }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
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

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        setSelectedConnection(null);
        setInsertMenu(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
      setCanvasDoc((prev) => {
        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: prev.workflow.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
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
      updateNode(selectedNode.id, {
        settings: effectiveSettings,
      });
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
      updateNode(selectedNode.id, { label });
    },
    [selectedNode, updateNode]
  );

  const handleSelectedNodePromptChange = useCallback(
    (prompt: string) => {
      if (!selectedNode) {
        return;
      }
      updateNode(selectedNode.id, { prompt });
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

      updateNode(selectedNode.id, {
        providerId,
        modelId: model?.modelId || "",
        outputType,
        nodeType: nodeTypeFromOutput(outputType),
        settings: resolveModelSettings(model, selectedNode.settings, selectedNodeExecutionMode),
      });
    },
    [groupedProviders, selectedNode, selectedNodeExecutionMode, selectedNodeIsModel, updateNode]
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

      updateNode(selectedNode.id, {
        modelId,
        outputType,
        nodeType: nodeTypeFromOutput(outputType),
        settings: resolveModelSettings(model, selectedNode.settings, selectedNodeExecutionMode),
      });
    },
    [groupedProviders, selectedNode, selectedNodeExecutionMode, selectedNodeIsModel, updateNode]
  );

  const handleClearSelectedInputs = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    if (selectedNodeIsModel) {
      updateNode(selectedNode.id, {
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        promptSourceNodeId: null,
      });
      return;
    }

    if (selectedNodeIsTextTemplate) {
      updateNode(selectedNode.id, {
        upstreamNodeIds: [],
        upstreamAssetIds: [],
      });
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
        setCanvasDoc((prev) => {
          const baseX =
            position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
          const baseY =
            position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

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

            const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, ...sourceNodeIds])];
            return {
              ...node,
              upstreamNodeIds,
              upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, [...prev.workflow.nodes, ...sourceNodes]),
            };
          });

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: [...nextNodes, ...sourceNodes],
            },
          };

          queueCanvasSave(nextDoc);
          const lastSourceNode = sourceNodes[sourceNodes.length - 1];
          setSelectedNodeIds(lastSourceNode ? [lastSourceNode.id] : []);
          setSelectedConnection(null);
          setInsertMenu(null);
          return nextDoc;
        });
      } catch (error) {
        console.error(error);
      } finally {
        pendingUploadAnchorRef.current = null;
      }
    },
    [projectId, providers, queueCanvasSave]
  );

  const spawnAssetPointerNodes = useCallback(
    (assets: Asset[], position?: { x: number; y: number }, options?: { connectToModelNodeId?: string }) => {
      if (assets.length === 0) {
        return;
      }

      const defaultProvider = fallbackProviderModel(providers);
      setCanvasDoc((prev) => {
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

          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, ...sourceNodeIds])];
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, [...prev.workflow.nodes, ...sourceNodes]),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...nextNodes, ...sourceNodes],
          },
        };

        queueCanvasSave(nextDoc);
        const lastSourceNode = sourceNodes[sourceNodes.length - 1];
        setSelectedNodeIds(lastSourceNode ? [lastSourceNode.id] : []);
        setSelectedConnection(null);
        setAssetPicker(null);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const handleCanvasInsertRequest = useCallback(
    (request: CanvasInsertRequest) => {
      setSelectedConnection(null);

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
    [addModelNode, addTextTemplateNode, nodesById]
  );

  const removeConnection = useCallback(
    (connection: CanvasConnection | null) => {
      if (!connection) {
        return;
      }

      setCanvasDoc((prev) => {
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

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });

      setSelectedConnection(null);
    },
    [queueCanvasSave]
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      setCanvasDoc((prev) => {
        const sourceNode = prev.workflow.nodes.find((node) => node.id === nodeId);
        if (!sourceNode) {
          return prev;
        }

        const duplicateBase =
          sourceNode.kind === "model"
            ? {
                ...sourceNode,
              }
            : sourceNode.kind === "text-template"
              ? {
                  ...sourceNode,
                }
              : sourceNode.kind === "text-note"
              ? {
                  ...sourceNode,
                  settings: isGeneratedTextNoteNode(sourceNode) ? createTextNoteSettings() : sourceNode.settings,
                  promptSourceNodeId: null,
                  upstreamNodeIds: [],
                  upstreamAssetIds: [],
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

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, duplicate],
          },
        };

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([duplicate.id]);
        setSelectedConnection(null);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) {
        return;
      }

      setCanvasDoc((prev) => {
        const sourceNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId);
        const targetNode = prev.workflow.nodes.find((node) => node.id === targetNodeId);
        if (!sourceNode || !targetNode) {
          return prev;
        }

        if (targetNode.kind === "text-note" || targetNode.kind === "list") {
          return prev;
        }

        if (sourceNode.kind === "text-note") {
          if (targetNode.kind !== "model") {
            return prev;
          }

          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  promptSourceNodeId: sourceNodeId,
                }
              : node
          );

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          };

          queueCanvasSave(nextDoc);
          return nextDoc;
        }

        if (sourceNode.kind === "list") {
          if (targetNode.kind !== "text-template") {
            return prev;
          }

          const nextNodes = prev.workflow.nodes.map((node) =>
            node.id === targetNodeId
              ? {
                  ...node,
                  upstreamNodeIds: [sourceNodeId],
                  upstreamAssetIds: buildAssetRefsFromNodes([sourceNodeId], prev.workflow.nodes),
                }
              : node
          );

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: nextNodes,
            },
          };

          queueCanvasSave(nextDoc);
          return nextDoc;
        }

        if (targetNode.kind === "text-template") {
          return prev;
        }

        if (sourceNode.kind === "text-template") {
          return prev;
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

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const removeNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) {
        return;
      }
      const nodeIdSet = new Set(nodeIds);

      setCanvasDoc((prev) => {
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

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });

      setSelectedNodeIds((current) => current.filter((nodeId) => !nodeIdSet.has(nodeId)));
      setSelectedConnection((current) =>
        current && (nodeIdSet.has(current.sourceNodeId) || nodeIdSet.has(current.targetNodeId)) ? null : current
      );
    },
    [queueCanvasSave]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.length === 0) {
      return;
    }
    removeNodes(selectedNodeIds);
  }, [removeNodes, selectedNodeIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        if (selectedNodeIds.length !== 1 || isInputLikeElement(event.target)) {
          return;
        }

        event.preventDefault();
        duplicateNode(selectedNodeIds[0]);
        return;
      }

      if (event.key === "Escape" && selectedConnection) {
        event.preventDefault();
        setSelectedConnection(null);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (isInputLikeElement(event.target)) {
        return;
      }

      if (selectedConnection) {
        event.preventDefault();
        removeConnection(selectedConnection);
        return;
      }

      if (selectedNodeIds.length === 0) {
        return;
      }

      event.preventDefault();
      removeNodes(selectedNodeIds);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [duplicateNode, removeConnection, removeNodes, selectedConnection, selectedNodeIds]);

  const updateViewport = useCallback(
    (nextViewport: CanvasDocument["canvasViewport"]) => {
      setCanvasDoc((prev) => {
        const nextDoc: CanvasDocument = {
          ...prev,
          canvasViewport: nextViewport,
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const insertGeneratedOutputPlaceholder = useCallback(
    (job: Job, sourceNodeId: string, outputCount: number) => {
      setCanvasDoc((prev) => {
        if (
          prev.workflow.nodes.filter(
            (node) =>
              getNodeSourceJobId(node) === job.id &&
              (typeof node.settings.sourceModelNodeId === "string" || node.upstreamNodeIds.includes(sourceNodeId))
          ).length >= outputCount
        ) {
          return prev;
        }

        const modelNode = prev.workflow.nodes.find((node) => node.id === sourceNodeId && node.kind === "model");
        if (!modelNode) {
          return prev;
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
            x: Math.round(
              modelNode.x + generatedNodeBaseOffsetX + Math.floor(visualIndex / 4) * generatedNodeColumnOffsetX
            ),
            y: Math.round(modelNode.y + (visualIndex % 4) * generatedNodeOffsetY),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, ...outputNodes],
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const updateSelectedListSettings = useCallback(
    (nextSettings: ListNodeSettings) => {
      if (!selectedNode || !selectedNodeIsList) {
        return;
      }

      updateNode(selectedNode.id, {
        settings: nextSettings,
      });
    },
    [selectedNode, selectedNodeIsList, updateNode]
  );

  const updateSelectedListColumnLabel = useCallback(
    (columnId: string, label: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings({
        ...selectedListSettings,
        columns: selectedListSettings.columns.map((column) => (column.id === columnId ? { ...column, label } : column)),
      });
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const updateSelectedListCell = useCallback(
    (rowId: string, columnId: string, value: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings({
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
      });
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const addSelectedListColumn = useCallback(() => {
    if (!selectedListSettings) {
      return;
    }

    const nextColumn = {
      id: uid(),
      label: `Column ${selectedListSettings.columns.length + 1}`,
    };

    updateSelectedListSettings({
      ...selectedListSettings,
      columns: [...selectedListSettings.columns, nextColumn],
      rows: selectedListSettings.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          [nextColumn.id]: "",
        },
      })),
    });
  }, [selectedListSettings, updateSelectedListSettings]);

  const removeSelectedListColumn = useCallback(
    (columnId: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings({
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
      });
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const addSelectedListRow = useCallback(() => {
    if (!selectedListSettings) {
      return;
    }

    updateSelectedListSettings({
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
    });
  }, [selectedListSettings, updateSelectedListSettings]);

  const removeSelectedListRow = useCallback(
    (rowId: string) => {
      if (!selectedListSettings) {
        return;
      }

      updateSelectedListSettings({
        ...selectedListSettings,
        rows: selectedListSettings.rows.filter((row) => row.id !== rowId),
      });
    },
    [selectedListSettings, updateSelectedListSettings]
  );

  const generateTextTemplateOutputs = useCallback(
    (nodeId: string) => {
      setCanvasDoc((prev) => {
        const templateNode = prev.workflow.nodes.find((node) => node.id === nodeId && node.kind === "text-template");
        if (!templateNode) {
          return prev;
        }

        const listNode = templateNode.upstreamNodeIds
          .map((upstreamNodeId) => prev.workflow.nodes.find((candidate) => candidate.id === upstreamNodeId) || null)
          .find((candidate) => candidate?.kind === "list") || null;
        const preview = buildTextTemplatePreview(
          templateNode.prompt,
          listNode ? getListNodeSettings(listNode.settings) : null
        );

        if (!listNode || preview.disabledReason) {
          return prev;
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
          return prev;
        }

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, ...outputNodes],
          },
        };

        queueCanvasSave(nextDoc);
        setSelectedNodeIds(outputNodes.length > 0 ? [outputNodes[outputNodes.length - 1].id] : []);
        setSelectedConnection(null);
        return nextDoc;
      });
    },
    [queueCanvasSave]
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
      insertGeneratedOutputPlaceholder(job, node.id, requestPreview.requestPayload.nodePayload.outputCount);
      await fetchJobs();
    },
    [buildNodeRunRequest, fetchJobs, generateTextTemplateOutputs, insertGeneratedOutputPlaceholder, projectId]
  );

  const onFilePickerChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      uploadFilesToCanvas(
        files,
        pendingUploadAnchorRef.current
          ? { x: pendingUploadAnchorRef.current.x, y: pendingUploadAnchorRef.current.y }
          : undefined,
        pendingUploadAnchorRef.current?.connectToModelNodeId
          ? { connectToModelNodeId: pendingUploadAnchorRef.current.connectToModelNodeId }
          : undefined
      ).catch(console.error);
    },
    [uploadFilesToCanvas]
  );

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

  return (
    <WorkspaceShell
      projectId={projectId}
      view="canvas"
      jobs={jobs}
      showQueuePill
      queuePillPlacement="top-right"
    >
      <div className={styles.page}>
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
            onUpdateTextNote={(nodeId, prompt) => updateNode(nodeId, { prompt })}
            onRequestInsertMenu={handleCanvasInsertRequest}
            onDropFiles={(files, position) => {
              uploadFilesToCanvas(files, position).catch(console.error);
            }}
            onViewportChange={updateViewport}
            onNodePositionChange={(nodeId, nodePosition) => updateNode(nodeId, nodePosition)}
            onConnectNodes={connectNodes}
            onSelectConnection={setSelectedConnection}
          />
        )}

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
            {insertMenu.mode === "canvas" ? (
              <button
                type="button"
                onClick={() => addTextTemplateNode({ x: insertMenu.worldX, y: insertMenu.worldY })}
              >
                Add Text Template
              </button>
            ) : null}
            {insertMenu.mode !== "template-input" ? (
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
                  fileInputRef.current?.click();
                }}
              >
                Upload Assets
              </button>
            ) : null}
            {insertMenu.mode !== "template-input" ? (
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
            {insertMenu.mode !== "template-input" ? (
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
                        <img className={styles.assetPickerThumb} src={`/api/assets/${asset.id}/file`} alt={asset.id} />
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

        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          multiple
          onChange={onFilePickerChange}
        />

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
          selectedGeneratedTextSettings={selectedNodeGeneratedTextSettings}
          selectedGeneratedTextTemplateNode={selectedGeneratedTextTemplateNode}
          selectedGeneratedTextListNode={selectedGeneratedTextListNode}
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
          onOpenCompare={openCompare}
          onOpenQueueInspect={openQueueInspect}
        />
      </div>
    </WorkspaceShell>
  );
}
