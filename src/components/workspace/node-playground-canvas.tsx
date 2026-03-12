"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasNodeContent,
  type ActiveCanvasNodeEditorState,
  type CanvasModelEditorState,
} from "@/components/canvas-nodes";
import {
  CanvasFocusPreflightLayer,
  useCanvasFocusPreflightMeasurement,
} from "@/components/canvas-focus-preflight";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import type {
  CanvasConnection,
  CanvasNodeGeneratedProvenance,
  CanvasPhantomPreview,
  CanvasRenderNode,
} from "@/components/canvas-node-types";
import type {
  CanvasDocument,
  ListNodeSettings,
  ProviderModel,
  WorkflowNode,
  WorkflowNodeSize,
} from "@/components/workspace/types";
import { canConnectCanvasNodes } from "@/lib/canvas-connection-rules";
import {
  getWorkflowNodeDefaultSize,
  resolveCanvasNodePresentation,
} from "@/lib/canvas-node-presentation";
import { getGeneratedDescriptorDefaultLabel } from "@/lib/generated-text-output";
import { getModelCatalogVariantById, getModelCatalogVariants, type NodePlaygroundFixture } from "@/lib/node-catalog";
import { getNodePlaygroundPreviewImageUrl } from "@/lib/node-playground-preview";
import {
  buildNodePlaygroundMeasuredCorrection,
  buildNodePlaygroundTransitionLayout,
  buildFramedViewportForNode,
  getActiveNodePlaygroundMode,
  getInitialNodePlaygroundMode,
  preserveNodeCenterPosition,
  shouldCorrectNodePlaygroundMeasuredSize,
  type NodePlaygroundMode,
} from "@/lib/node-playground-modes";
import {
  buildTextTemplatePreview,
  getGeneratedModelNodeSource,
  getGeneratedTextNoteSettings,
  getListNodeSettings,
} from "@/lib/list-template";
import { isModelParameterVisible } from "@/lib/model-parameters";
import { getTextOutputTargetLabel, readTextOutputTarget } from "@/lib/text-output-targets";
import {
  isRunnableTopazGigapixelModel,
} from "@/lib/topaz-gigapixel-settings";
import {
  buildProviderDebugRequest,
  isRunnableTextModel,
  resolveImageModelSettings,
  resolveProviderModelSettings,
} from "@/lib/provider-model-helpers";
import { getUploadedAssetNodeAspectRatio } from "@/lib/canvas-asset-nodes";
import styles from "./node-playground-canvas.module.css";

type Props = {
  fixture: NodePlaygroundFixture;
  providerModels: ProviderModel[];
  selectedModelVariantId?: string | null;
  onModelVariantChange?: (variantId: string) => void;
  initialFullNodeId?: string | null;
};

const PLAYGROUND_MODE_OPTIONS: Array<{ id: NodePlaygroundMode; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "preview", label: "Preview" },
  { id: "edit", label: "Edit" },
  { id: "resize", label: "Resize" },
];
const PLAYGROUND_LAYOUT_MOTION_MS = 240;
const PLAYGROUND_LAYOUT_MOTION_BUFFER_MS = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cloneFixtureDoc(fixture: NodePlaygroundFixture): CanvasDocument {
  return {
    canvasViewport: fixture.viewport || {
      x: 0,
      y: 0,
      zoom: 0.9,
    },
    workflow: {
      nodes: fixture.nodes.map((node) => ({
        ...node,
        settings: JSON.parse(JSON.stringify(node.settings || {})) as WorkflowNode["settings"],
        upstreamNodeIds: [...node.upstreamNodeIds],
        upstreamAssetIds: [...node.upstreamAssetIds],
      })),
    },
    generatedOutputReceiptKeys: [],
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

function getModelDefaultSettings(model: ProviderModel | undefined) {
  return model?.capabilities?.defaults ? { ...model.capabilities.defaults } : {};
}

function getModelSupportedOutputs(model: ProviderModel | undefined): WorkflowNode["outputType"][] {
  const capabilities = model?.capabilities;
  const outputs = ["image", "video", "text"].filter((outputType) => capabilities?.[outputType as "image" | "video" | "text"]);
  return outputs.length > 0 ? (outputs as WorkflowNode["outputType"][]) : ["image"];
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

function outputSemanticType(node: WorkflowNode) {
  if (node.kind === "text-template") {
    return "operator" as const;
  }
  if (node.kind === "model") {
    return "citrus" as const;
  }
  return node.outputType;
}

function getNodeSourceJobId(node: WorkflowNode | null | undefined) {
  if (!node) {
    return null;
  }
  if (node.sourceJobId) {
    return node.sourceJobId;
  }
  if (node.settings && typeof node.settings === "object" && typeof (node.settings as Record<string, unknown>).sourceJobId === "string") {
    return String((node.settings as Record<string, unknown>).sourceJobId);
  }
  return null;
}

function getSourceModelNodeId(node: WorkflowNode) {
  if (node.kind === "asset-source" && node.settings && typeof node.settings === "object") {
    const value = (node.settings as Record<string, unknown>).sourceModelNodeId;
    return typeof value === "string" ? value : null;
  }

  if ((node.kind === "list" || node.kind === "text-template" || node.kind === "text-note") && node.settings && typeof node.settings === "object") {
    const value = (node.settings as Record<string, unknown>).sourceModelNodeId;
    return typeof value === "string" ? value : null;
  }

  return null;
}

function isGeneratedAssetNode(node: WorkflowNode) {
  return node.kind === "asset-source" && getNodeSourceJobId(node) !== null;
}

function getGeneratedNodeProvenance(node: WorkflowNode): CanvasNodeGeneratedProvenance | null {
  if (node.kind === "asset-source" && isGeneratedAssetNode(node)) {
    return "model";
  }

  if (node.kind === "text-note" && getGeneratedTextNoteSettings(node.settings)) {
    return "operator";
  }

  return getGeneratedModelNodeSource(node.settings) ? "model" : null;
}

function getExecutionModeForModelNode(node: WorkflowNode, model: ProviderModel | undefined) {
  if (node.kind !== "model") {
    return "generate" as const;
  }

  return isRunnableTopazGigapixelModel(model?.providerId, model?.modelId)
    ? ("edit" as const)
    : isRunnableTextModel(model?.providerId, model?.modelId)
      ? ("generate" as const)
      : node.upstreamNodeIds.length > 0
        ? ("edit" as const)
        : ("generate" as const);
}

function getRunPreview(node: WorkflowNode, model: ProviderModel | undefined) {
  if (node.kind !== "model" || !model) {
    return null;
  }

  const executionMode = getExecutionModeForModelNode(node, model);
  const outputCount =
    resolveImageModelSettings(model.providerId, model.modelId, node.settings, executionMode)?.outputCount || 1;

  const requestPayload = {
    providerId: model.providerId,
    modelId: model.modelId,
    nodePayload: {
      nodeId: node.id,
      nodeType: node.nodeType,
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
  };

  if (isRunnableTextModel(model.providerId, model.modelId)) {
    const preview = buildProviderDebugRequest({
      providerId: model.providerId,
      modelId: model.modelId,
      prompt: node.prompt,
      rawSettings: node.settings,
      executionMode,
      inputImageAssetIds: [],
    });
    const textOutputTarget = readTextOutputTarget((node.settings as Record<string, unknown>).textOutputTarget);
    return {
      disabledReason: preview?.validationError || null,
      readyMessage:
        preview?.validationError ||
        `Ready for ${getTextOutputTargetLabel(textOutputTarget).toLowerCase()} output.`,
      endpoint: preview?.endpoint || "ai.models.generateContent",
      requestPayload,
    };
  }

  if (resolveImageModelSettings(model.providerId, model.modelId, node.settings, executionMode)) {
    const preview = buildProviderDebugRequest({
      providerId: model.providerId,
      modelId: model.modelId,
      prompt: node.prompt,
      rawSettings: node.settings,
      executionMode,
      inputImageAssetIds: [],
    });
    return {
      disabledReason: preview?.validationError || null,
      readyMessage:
        preview?.validationError ? null : `Ready for image generation with ${outputCount} output${outputCount === 1 ? "" : "s"}.`,
      endpoint: preview?.endpoint || "ai.models.generateContent",
      requestPayload,
    };
  }

  if (isRunnableTopazGigapixelModel(model.providerId, model.modelId)) {
    const preview = buildProviderDebugRequest({
      providerId: model.providerId,
      modelId: model.modelId,
      prompt: node.prompt,
      rawSettings: node.settings,
      executionMode,
      inputImageAssetIds: [],
      inputAssets: [],
    });
    return {
      disabledReason: preview?.validationError || null,
      readyMessage: preview?.validationError ? null : "Ready for transform output.",
      endpoint: preview?.endpoint || "/enhance",
      requestPayload,
    };
  }

  return {
    disabledReason: null,
    readyMessage: "Preview only in the library playground.",
    endpoint: `${model.providerId}.${model.modelId}`,
    requestPayload,
  };
}

export function NodePlaygroundCanvas({
  fixture,
  providerModels,
  selectedModelVariantId,
  onModelVariantChange,
  initialFullNodeId = null,
}: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const playgroundModeDockRef = useRef<HTMLDivElement | null>(null);
  const primaryTransitionTokenRef = useRef(0);
  const primaryNodeId = fixture.primaryNodeId;
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(() => cloneFixtureDoc(fixture));
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<CanvasConnection | null>(null);
  const [activeFullNodeId, setActiveFullNodeId] = useState<string | null>(null);
  const [pinnedModelFullNodeId, setPinnedModelFullNodeId] = useState<string | null>(null);
  const [libraryFullNodeId, setLibraryFullNodeId] = useState<string | null>(initialFullNodeId);
  const [primaryNodeTransition, setPrimaryNodeTransition] = useState<{
    nodeId: string;
    targetCenter: { x: number; y: number };
    predictedSize: WorkflowNodeSize;
  } | null>(null);
  const [hasCenteredFixture, setHasCenteredFixture] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const {
    request: preflightRequest,
    measureNode: measurePreflightNode,
    resolveMeasurement: resolvePreflightMeasurement,
  } = useCanvasFocusPreflightMeasurement();

  useEffect(() => {
    setCanvasDoc(cloneFixtureDoc(fixture));
    setSelectedNodeIds([]);
    setSelectedConnection(null);
    setActiveFullNodeId(null);
    setPinnedModelFullNodeId(null);
    setLibraryFullNodeId(initialFullNodeId);
    setPrimaryNodeTransition(null);
    setHasCenteredFixture(false);
  }, [fixture, initialFullNodeId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const getPlaygroundFocusSafeInsets = useCallback(
    (surfaceSize: { width: number; height: number }) => {
      const dockHeight = primaryNodeId ? playgroundModeDockRef.current?.offsetHeight || 0 : 0;
      return {
        top: clamp(Math.round(surfaceSize.height * 0.055), 24, 76),
        right: clamp(Math.round(surfaceSize.width * 0.045), 24, 72),
        bottom: clamp(Math.round(surfaceSize.height * 0.065), 28, 88) + dockHeight + (dockHeight > 0 ? 18 : 0),
        left: clamp(Math.round(surfaceSize.width * 0.045), 24, 72),
      };
    },
    [primaryNodeId]
  );

  const modelCatalogVariants = useMemo(() => getModelCatalogVariants(providerModels), [providerModels]);

  const nodesById = useMemo(() => {
    return canvasDoc.workflow.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [canvasDoc.workflow.nodes]);

  const activeNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] || null : null;
  const selectedNode = useMemo(() => (activeNodeId ? nodesById[activeNodeId] || null : null), [activeNodeId, nodesById]);
  const effectiveFullNodeId = activeFullNodeId || pinnedModelFullNodeId;
  const selectedModel = useMemo(
    () =>
      selectedNode?.kind === "model"
        ? providerModels.find(
            (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
          )
        : undefined,
    [providerModels, selectedNode]
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
    if (libraryFullNodeId && !nodesById[libraryFullNodeId]) {
      setLibraryFullNodeId(null);
    }
  }, [libraryFullNodeId, nodesById]);

  const getRenderedNodeSize = useCallback((nodeId: string): WorkflowNodeSize | null => {
    const surfaceElement = canvasRef.current;
    const nodeElement = surfaceElement?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!nodeElement) {
      return null;
    }

    const width = Math.round(nodeElement.offsetWidth);
    const height = Math.round(nodeElement.offsetHeight);
    if (width <= 0 || height <= 0) {
      return null;
    }

    return { width, height };
  }, []);

  const getCanvasSurfaceSize = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width < 120 || bounds.height < 120) {
      return null;
    }

    return {
      width: bounds.width,
      height: bounds.height,
    };
  }, []);

  useEffect(() => {
    if (!selectedModelVariantId) {
      return;
    }

    const variant = getModelCatalogVariantById(providerModels, selectedModelVariantId);
    if (!variant) {
      return;
    }
    const providerModel = providerModels.find(
      (model) => model.providerId === variant.providerId && model.modelId === variant.modelId
    );
    if (!providerModel) {
      return;
    }

    setCanvasDoc((current) => {
      const nextNodes = current.workflow.nodes.map((node) => {
        if (node.kind !== "model") {
          return node;
        }
        const nextOutputType = resolveOutputType(node.outputType, getModelSupportedOutputs(providerModel));
        return {
          ...node,
          providerId: providerModel.providerId,
          modelId: providerModel.modelId,
          outputType: nextOutputType,
          nodeType: nodeTypeFromOutput(nextOutputType),
          settings: resolveModelSettings(providerModel, node.settings, "generate"),
        };
      });

      return {
        ...current,
        workflow: {
          nodes: nextNodes,
        },
      };
    });
  }, [providerModels, selectedModelVariantId]);

  const updateViewport = useCallback((nextViewport: CanvasDocument["canvasViewport"]) => {
    setCanvasDoc((current) => ({
      ...current,
      canvasViewport: nextViewport,
    }));
  }, []);

  const selectSingleNode = useCallback((nodeId: string | null) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
    setSelectedConnection(null);
  }, []);

  const updateNode = useCallback((nodeId: string, mutate: (node: WorkflowNode, allNodes: WorkflowNode[]) => WorkflowNode) => {
    setCanvasDoc((current) => ({
      ...current,
      workflow: {
        nodes: current.workflow.nodes.map((node) => (node.id === nodeId ? mutate(node, current.workflow.nodes) : node)),
      },
    }));
  }, []);

  const handleNodeDisplayModeChange = useCallback((nodeId: string, mode: "preview" | "compact") => {
    if (nodeId === primaryNodeId) {
      void transitionPrimaryNode(mode);
      return;
    }

    updateNode(nodeId, (node) => ({
      ...node,
      displayMode: mode,
      size: null,
    }));
    if (activeFullNodeId === nodeId) {
      setActiveFullNodeId(null);
    }
    if (pinnedModelFullNodeId === nodeId) {
      setPinnedModelFullNodeId(null);
    }
    if (libraryFullNodeId === nodeId) {
      setLibraryFullNodeId(null);
    }
  }, [activeFullNodeId, libraryFullNodeId, pinnedModelFullNodeId, primaryNodeId, transitionPrimaryNode, updateNode]);

  const handleNodeResizeStart = useCallback((nodeId: string, size: WorkflowNodeSize) => {
    const node = nodesById[nodeId];
    if (!node || node.kind !== "model" || node.displayMode === "resized") {
      return;
    }

    updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      displayMode: "resized",
      size,
    }));
    if (activeFullNodeId === nodeId) {
      setActiveFullNodeId(null);
    }
    if (pinnedModelFullNodeId === nodeId) {
      setPinnedModelFullNodeId(null);
    }
    if (libraryFullNodeId === nodeId) {
      setLibraryFullNodeId(null);
    }
    if (primaryNodeId === nodeId) {
      setPrimaryNodeTransition(null);
    }
  }, [activeFullNodeId, libraryFullNodeId, nodesById, pinnedModelFullNodeId, primaryNodeId, updateNode]);

  const handleNodeSizeCommit = useCallback((nodeId: string, size: WorkflowNodeSize) => {
    updateNode(nodeId, (node) => ({
      ...node,
      displayMode: "resized",
      size,
    }));
    if (activeFullNodeId === nodeId) {
      setActiveFullNodeId(null);
    }
    if (pinnedModelFullNodeId === nodeId) {
      setPinnedModelFullNodeId(null);
    }
    if (libraryFullNodeId === nodeId) {
      setLibraryFullNodeId(null);
    }
    if (primaryNodeId === nodeId) {
      setPrimaryNodeTransition(null);
    }
  }, [activeFullNodeId, libraryFullNodeId, pinnedModelFullNodeId, primaryNodeId, updateNode]);

  const handleModelVariantSelection = useCallback((variantId: string) => {
    if (!selectedNode || selectedNode.kind !== "model") {
      return;
    }

    const variant = getModelCatalogVariantById(providerModels, variantId);
    if (!variant) {
      return;
    }

    const providerModel = providerModels.find(
      (candidate) => candidate.providerId === variant.providerId && candidate.modelId === variant.modelId
    );
    if (!providerModel) {
      return;
    }

    updateNode(selectedNode.id, (node, allNodes) => {
      const nextOutputType = resolveOutputType(node.outputType, getModelSupportedOutputs(providerModel));
      const nextUpstreamNodeIds = isRunnableTextModel(providerModel.providerId, providerModel.modelId)
        ? []
        : node.upstreamNodeIds;
      return {
        ...node,
        providerId: providerModel.providerId,
        modelId: providerModel.modelId,
        outputType: nextOutputType,
        nodeType: nodeTypeFromOutput(nextOutputType),
        upstreamNodeIds: nextUpstreamNodeIds,
        upstreamAssetIds: isRunnableTextModel(providerModel.providerId, providerModel.modelId)
          ? []
          : buildAssetRefsFromNodes(nextUpstreamNodeIds, allNodes),
        settings: resolveModelSettings(providerModel, node.settings, "generate"),
      };
    });
    onModelVariantChange?.(variantId);
  }, [onModelVariantChange, providerModels, selectedNode, updateNode]);

  const selectedInputNodes = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return selectedNode.upstreamNodeIds.map((nodeId) => nodesById[nodeId]).filter((node): node is WorkflowNode => Boolean(node));
  }, [nodesById, selectedNode]);

  const selectedPromptSourceNode = useMemo(() => {
    if (!selectedNode?.promptSourceNodeId) {
      return null;
    }
    return nodesById[selectedNode.promptSourceNodeId] || null;
  }, [nodesById, selectedNode?.promptSourceNodeId]);

  const selectedListSettings = useMemo<ListNodeSettings | null>(() => {
    if (!selectedNode || selectedNode.kind !== "list") {
      return null;
    }
    return getListNodeSettings(selectedNode.settings);
  }, [selectedNode]);

  const selectedTemplateListNode = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "text-template") {
      return null;
    }
    return selectedInputNodes.find((node) => node.kind === "list") || null;
  }, [selectedInputNodes, selectedNode]);

  const selectedTemplatePreview = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "text-template") {
      return null;
    }
    return buildTextTemplatePreview(
      selectedNode.prompt,
      selectedTemplateListNode ? getListNodeSettings(selectedTemplateListNode.settings) : null
    );
  }, [selectedNode, selectedTemplateListNode]);

  const selectedNodeExecutionMode = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "model") {
      return "generate" as const;
    }

    return getExecutionModeForModelNode(selectedNode, selectedModel);
  }, [selectedModel, selectedNode]);

  const selectedNodeResolvedSettings = useMemo<Record<string, unknown>>(() => {
    if (!selectedNode || selectedNode.kind !== "model") {
      return {};
    }
    return resolveModelSettings(selectedModel, selectedNode.settings, selectedNodeExecutionMode) as Record<string, unknown>;
  }, [selectedModel, selectedNode, selectedNodeExecutionMode]);

  const selectedModelParameters = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== "model" || !selectedModel) {
      return [];
    }
    return (selectedModel.capabilities.parameters || []).filter((parameter) =>
      isModelParameterVisible(parameter, {
        executionMode: selectedNodeExecutionMode,
        settings: selectedNodeResolvedSettings,
      })
    );
  }, [selectedModel, selectedNode, selectedNodeExecutionMode, selectedNodeResolvedSettings]);

  const activeEditor = useMemo<ActiveCanvasNodeEditorState | null>(() => {
    if (!selectedNode) {
      return null;
    }

    return {
      nodeId: selectedNode.id,
      selectedNode,
      selectedModel: selectedNode.kind === "model" ? selectedModel : undefined,
      selectedNodeRunPreview: selectedNode.kind === "model" ? getRunPreview(selectedNode, selectedModel) : null,
      selectedNodeResolvedSettings: selectedNode.kind === "model" ? selectedNodeResolvedSettings : {},
      selectedCoreParameters:
        selectedNode.kind === "model" ? selectedModelParameters.filter((parameter) => parameter.section === "core") : [],
      selectedAdvancedParameters:
        selectedNode.kind === "model" ? selectedModelParameters.filter((parameter) => parameter.section === "advanced") : [],
      selectedInputNodes,
      selectedPromptSourceNode,
      selectedListSettings,
      selectedTemplatePreview,
      selectedTemplateListNode,
      selectedNodeSourceJobId: getNodeSourceJobId(selectedNode),
      selectedSingleImageAssetId: selectedNode.kind === "asset-source" ? selectedNode.sourceAssetId : null,
      modelCatalogVariants,
    };
  }, [
    modelCatalogVariants,
    selectedInputNodes,
    selectedListSettings,
    selectedModel,
    selectedModelParameters,
    selectedNode,
    selectedNodeResolvedSettings,
    selectedPromptSourceNode,
    selectedTemplateListNode,
    selectedTemplatePreview,
  ]);

  const buildPassiveModelEditor = useCallback(
    (node: CanvasRenderNode): CanvasModelEditorState | null => {
      if (node.kind !== "model") {
        return null;
      }

      const selectedModel =
        providerModels.find((model) => model.providerId === node.providerId && model.modelId === node.modelId) || undefined;
      const executionMode = getExecutionModeForModelNode(node, selectedModel);
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
        .map((nodeId) => nodesById[nodeId])
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
    [modelCatalogVariants, nodesById, providerModels]
  );

  const canvasNodes = useMemo<CanvasRenderNode[]>(() => {
    const displayNameMap = providerModels.reduce<Record<string, string>>((acc, model) => {
      acc[`${model.providerId}:${model.modelId}`] = model.displayName;
      return acc;
    }, {});

    return canvasDoc.workflow.nodes.map((node) => {
      const listSettings = node.kind === "list" ? getListNodeSettings(node.settings) : null;
      const connectedListNode =
        node.kind === "text-template"
          ? canvasDoc.workflow.nodes.find((candidate) => candidate.id === node.upstreamNodeIds[0] && candidate.kind === "list") || null
          : null;
      const templatePreview =
        node.kind === "text-template"
          ? buildTextTemplatePreview(node.prompt, connectedListNode ? getListNodeSettings(connectedListNode.settings) : null)
          : null;
      const uploadedAssetAspectRatio = getUploadedAssetNodeAspectRatio(node) || undefined;
      const presentation = resolveCanvasNodePresentation({
        node,
        activeNodeId,
        fullNodeId: effectiveFullNodeId,
        nodeId: node.id,
        aspectRatio: uploadedAssetAspectRatio,
        forcedRenderMode: libraryFullNodeId === node.id ? "full" : null,
      });
      const generatedProvenance = getGeneratedNodeProvenance(node);
      return {
        ...node,
        presentation,
        assetOrigin: node.kind === "asset-source" ? (isGeneratedAssetNode(node) ? "generated" : "uploaded") : null,
        sourceModelNodeId: getSourceModelNodeId(node),
        generatedProvenance,
        displayModelName:
          node.kind === "asset-source"
            ? null
            : node.kind === "list"
              ? "List"
              : node.kind === "text-template"
                ? "Template"
                : displayNameMap[`${node.providerId}:${node.modelId}`] || node.modelId,
        displaySourceLabel:
          node.kind === "asset-source"
            ? isGeneratedAssetNode(node)
              ? "Generated Asset"
              : "Uploaded Asset"
            : node.kind === "list"
              ? `${listSettings?.columns.length || 0} col${(listSettings?.columns.length || 0) === 1 ? "" : "s"}`
              : node.kind === "text-template"
                ? templatePreview?.disabledReason || `${templatePreview?.nonBlankRowCount || 0} rows ready`
                : displayNameMap[`${node.providerId}:${node.modelId}`] || node.modelId,
        inputSemanticTypes: [
          ...(node.kind === "model" && node.promptSourceNodeId ? (["text"] as const) : []),
          ...node.upstreamNodeIds
            .map((nodeId) => nodesById[nodeId] || null)
            .filter((inputNode): inputNode is WorkflowNode => Boolean(inputNode))
            .map((inputNode) => outputSemanticType(inputNode)),
        ],
        outputSemanticType: outputSemanticType(node),
        previewImageUrl: getNodePlaygroundPreviewImageUrl(node),
        hasStartedJob: node.kind === "model" ? true : undefined,
        listPreviewColumns: listSettings?.columns.slice(0, 3).map((column) => column.label) || [],
        listPreviewRows:
          listSettings?.rows.slice(0, 3).map((row) =>
            listSettings.columns.slice(0, 3).map((column) => String(row.values[column.id] || "—"))
          ) || [],
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
        templateStatusMessage: templatePreview?.disabledReason || templatePreview?.readyMessage || null,
        renderMode: presentation.renderMode,
        canResize: presentation.canResize,
        lockAspectRatio: presentation.lockAspectRatio,
        resolvedSize: presentation.size,
      };
    });
  }, [activeNodeId, canvasDoc.workflow.nodes, effectiveFullNodeId, libraryFullNodeId, nodesById, providerModels]);

  const buildRenderNodeForMeasurement = useCallback(
    (
      candidateNode: WorkflowNode,
      options?: {
        activeNodeId?: string | null;
        fullNodeId?: string | null;
        forcedRenderMode?: "full" | "resized" | null;
      }
    ) => {
      const baseNode = canvasNodes.find((node) => node.id === candidateNode.id) || null;
      if (!baseNode) {
        return null;
      }

      const uploadedAssetAspectRatio = getUploadedAssetNodeAspectRatio(candidateNode) || undefined;
      const presentation = resolveCanvasNodePresentation({
        node: candidateNode,
        activeNodeId:
          options && Object.prototype.hasOwnProperty.call(options, "activeNodeId")
            ? options.activeNodeId ?? null
            : activeNodeId,
        fullNodeId:
          options && Object.prototype.hasOwnProperty.call(options, "fullNodeId")
            ? options.fullNodeId ?? null
            : effectiveFullNodeId,
        nodeId: candidateNode.id,
        aspectRatio: uploadedAssetAspectRatio,
        forcedRenderMode:
          options && Object.prototype.hasOwnProperty.call(options, "forcedRenderMode")
            ? options.forcedRenderMode ?? null
            : libraryFullNodeId === candidateNode.id
              ? "full"
              : null,
      });

      return {
        ...baseNode,
        ...candidateNode,
        presentation,
        renderMode: presentation.renderMode,
        canResize: presentation.canResize,
        lockAspectRatio: presentation.lockAspectRatio,
        resolvedSize: presentation.size,
      } satisfies CanvasRenderNode;
    },
    [activeNodeId, canvasNodes, effectiveFullNodeId, libraryFullNodeId]
  );

  const primaryRenderNode = useMemo(
    () => canvasNodes.find((node) => node.id === primaryNodeId) || null,
    [canvasNodes, primaryNodeId]
  );
  const primaryWorkflowNode = primaryNodeId ? nodesById[primaryNodeId] || null : null;
  const activePlaygroundMode = useMemo(() => {
    if (primaryRenderNode) {
      return getActiveNodePlaygroundMode(
        primaryRenderNode.presentation.persistedMode,
        primaryRenderNode.presentation.renderMode
      );
    }

    if (primaryWorkflowNode) {
      return getInitialNodePlaygroundMode(
        primaryWorkflowNode.displayMode,
        initialFullNodeId === primaryWorkflowNode.id
      );
    }

    return "preview" as const;
  }, [initialFullNodeId, primaryRenderNode, primaryWorkflowNode]);

  const centerPrimaryNodeInViewport = useCallback(async () => {
    const surfaceSize = getCanvasSurfaceSize();
    if (!surfaceSize || !primaryRenderNode) {
      return;
    }

    const measuredSize =
      getRenderedNodeSize(primaryRenderNode.id) ||
      (await measurePreflightNode(
        primaryWorkflowNode
          ? buildRenderNodeForMeasurement(primaryWorkflowNode, {
              activeNodeId,
              fullNodeId: effectiveFullNodeId,
              forcedRenderMode: libraryFullNodeId === primaryRenderNode.id ? "full" : null,
            })
          : null,
      )) ||
      primaryRenderNode.resolvedSize;

    updateViewport(
      buildFramedViewportForNode({
        nodePosition: { x: primaryRenderNode.x, y: primaryRenderNode.y },
        nodeSize: measuredSize,
        surfaceSize,
        safeInsets: getPlaygroundFocusSafeInsets(surfaceSize),
      })
    );
  }, [
    activeNodeId,
    buildRenderNodeForMeasurement,
    effectiveFullNodeId,
    getCanvasSurfaceSize,
    getPlaygroundFocusSafeInsets,
    getRenderedNodeSize,
    libraryFullNodeId,
    measurePreflightNode,
    primaryRenderNode,
    primaryWorkflowNode,
    updateViewport,
  ]);

  async function transitionPrimaryNode(mode: NodePlaygroundMode) {
    const nodeId = primaryNodeId;
    const workflowNode = nodeId ? nodesById[nodeId] || null : null;
    const renderNode = nodeId ? canvasNodes.find((node) => node.id === nodeId) || null : null;
    if (!workflowNode || !renderNode) {
      return;
    }

    const transitionToken = primaryTransitionTokenRef.current + 1;
    primaryTransitionTokenRef.current = transitionToken;

    const currentSize = getRenderedNodeSize(nodeId) || renderNode.resolvedSize;
    const aspectRatio = getUploadedAssetNodeAspectRatio(workflowNode) || 1;
    const surfaceSize = getCanvasSurfaceSize();
    const focusSafeInsets = surfaceSize ? getPlaygroundFocusSafeInsets(surfaceSize) : undefined;

    let nextDisplayMode = workflowNode.displayMode;
    let nextSize: WorkflowNodeSize | null = workflowNode.size;
    let nextForcedFullNodeId: string | null = null;

    if (mode === "compact") {
      nextDisplayMode = "compact";
      nextSize = null;
    } else if (mode === "preview") {
      nextDisplayMode = "preview";
      nextSize = null;
    } else if (mode === "edit") {
      nextDisplayMode = "preview";
      nextSize = null;
      nextForcedFullNodeId = nodeId;
    } else {
      nextDisplayMode = "resized";
      nextSize = fixture.resizePresetSize;
    }

    const nextWorkflowNode: WorkflowNode = {
      ...workflowNode,
      displayMode: nextDisplayMode,
      size: nextSize,
    };
    const resolvedNextSize =
      (await measurePreflightNode(
        buildRenderNodeForMeasurement(nextWorkflowNode, {
          activeNodeId: null,
          fullNodeId: null,
          forcedRenderMode: nextForcedFullNodeId === nodeId ? "full" : null,
        })
      )) ||
      (mode === "resize"
        ? fixture.resizePresetSize
        : getWorkflowNodeDefaultSize(workflowNode.kind, mode === "edit" ? "full" : nextDisplayMode, aspectRatio));

    if (primaryTransitionTokenRef.current !== transitionToken) {
      return;
    }

    const transitionLayout = surfaceSize
      ? buildNodePlaygroundTransitionLayout({
          currentPosition: { x: workflowNode.x, y: workflowNode.y },
          currentSize,
          nextSize: resolvedNextSize,
          surfaceSize,
          safeInsets: focusSafeInsets,
        })
      : null;
    const nextPosition = transitionLayout
      ? transitionLayout.nodePosition
      : preserveNodeCenterPosition(
          { x: workflowNode.x, y: workflowNode.y },
          currentSize,
          resolvedNextSize
        );

    updateNode(nodeId, (node) => ({
      ...node,
      displayMode: nextDisplayMode,
      size: nextSize,
      x: nextPosition.x,
      y: nextPosition.y,
    }));
    setActiveFullNodeId(null);
    setPinnedModelFullNodeId(null);
    setLibraryFullNodeId(nextForcedFullNodeId);
    if (transitionLayout) {
      updateViewport(transitionLayout.viewport);
      setPrimaryNodeTransition(
        prefersReducedMotion
          ? null
          : {
              nodeId,
              targetCenter: transitionLayout.targetCenter,
              predictedSize: resolvedNextSize,
            }
      );
    } else {
      setPrimaryNodeTransition(null);
    }
  }

  useEffect(() => {
    if (hasCenteredFixture || !primaryRenderNode) {
      return;
    }

    let cancelled = false;
    const frameId = window.requestAnimationFrame(() => {
      centerPrimaryNodeInViewport().finally(() => {
        if (!cancelled) {
          setHasCenteredFixture(true);
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [centerPrimaryNodeInViewport, hasCenteredFixture, primaryRenderNode]);

  useEffect(() => {
    if (!primaryNodeTransition || prefersReducedMotion) {
      return;
    }

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let frameId = 0;
    let corrected = false;
    const applyMeasuredCorrection = (measuredSize: WorkflowNodeSize | null, options?: { force?: boolean }) => {
      if (
        cancelled ||
        !measuredSize ||
        (!options?.force &&
          (corrected ||
            !shouldCorrectNodePlaygroundMeasuredSize(primaryNodeTransition.predictedSize, measuredSize)))
      ) {
        return;
      }

      const surfaceSize = getCanvasSurfaceSize();
      if (!surfaceSize) {
        return;
      }

      corrected = true;
      const correction = buildNodePlaygroundMeasuredCorrection({
        targetCenter: primaryNodeTransition.targetCenter,
        measuredSize,
        surfaceSize,
        safeInsets: getPlaygroundFocusSafeInsets(surfaceSize),
      });

      updateNode(primaryNodeTransition.nodeId, (node) => ({
        ...node,
        x: correction.nodePosition.x,
        y: correction.nodePosition.y,
      }));
      updateViewport(correction.viewport);
    };

    const timeoutId = window.setTimeout(() => {
      applyMeasuredCorrection(getRenderedNodeSize(primaryNodeTransition.nodeId), { force: true });
      setPrimaryNodeTransition((current) =>
        current?.nodeId === primaryNodeTransition.nodeId ? null : current
      );
    }, PLAYGROUND_LAYOUT_MOTION_MS + PLAYGROUND_LAYOUT_MOTION_BUFFER_MS);

    const attachObserver = () => {
      if (cancelled) {
        return;
      }

      const surfaceElement = canvasRef.current;
      const nodeElement = surfaceElement?.querySelector<HTMLElement>(`[data-node-id="${primaryNodeTransition.nodeId}"]`);
      if (!nodeElement) {
        frameId = window.requestAnimationFrame(attachObserver);
        return;
      }

      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        applyMeasuredCorrection({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        });
      });
      observer.observe(nodeElement);
      applyMeasuredCorrection(getRenderedNodeSize(primaryNodeTransition.nodeId));
    };

    frameId = window.requestAnimationFrame(attachObserver);

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.clearTimeout(timeoutId);
    };
  }, [
    getCanvasSurfaceSize,
    getPlaygroundFocusSafeInsets,
    getRenderedNodeSize,
    prefersReducedMotion,
    primaryNodeTransition,
    updateNode,
    updateViewport,
  ]);

  useEffect(() => {
    if (!prefersReducedMotion) {
      return;
    }
    setPrimaryNodeTransition(null);
  }, [prefersReducedMotion]);

  const enterNodeEditMode = useCallback(async (nodeId: string) => {
    const node = nodesById[nodeId];
    if (!node) {
      return;
    }

    if (nodeId === primaryNodeId && node.displayMode !== "resized" && (node.kind === "model" || node.kind === "text-template")) {
      const transitionToken = primaryTransitionTokenRef.current + 1;
      primaryTransitionTokenRef.current = transitionToken;
      const renderNode = canvasNodes.find((candidate) => candidate.id === nodeId) || null;
      const currentSize = getRenderedNodeSize(nodeId) || renderNode?.resolvedSize;
      const surfaceSize = getCanvasSurfaceSize();
      const focusSafeInsets = surfaceSize ? getPlaygroundFocusSafeInsets(surfaceSize) : undefined;
      if (currentSize) {
        const aspectRatio = getUploadedAssetNodeAspectRatio(node) || 1;
        const nextSize =
          (await measurePreflightNode(
            buildRenderNodeForMeasurement(node, {
              activeNodeId: nodeId,
              fullNodeId: nodeId,
              forcedRenderMode: null,
            })
          )) || getWorkflowNodeDefaultSize(node.kind, "full", aspectRatio);
        if (!nextSize || primaryTransitionTokenRef.current !== transitionToken) {
          return;
        }
        const transitionLayout = surfaceSize
          ? buildNodePlaygroundTransitionLayout({
              currentPosition: { x: node.x, y: node.y },
              currentSize,
              nextSize,
              surfaceSize,
              safeInsets: focusSafeInsets,
            })
          : null;
        const nextPosition = transitionLayout
          ? transitionLayout.nodePosition
          : preserveNodeCenterPosition(
              { x: node.x, y: node.y },
              currentSize,
              nextSize
            );
        updateNode(nodeId, (currentNode) => ({
          ...currentNode,
          x: nextPosition.x,
          y: nextPosition.y,
        }));
        if (transitionLayout) {
          updateViewport(transitionLayout.viewport);
          setPrimaryNodeTransition(
            prefersReducedMotion
              ? null
              : {
                  nodeId,
                  targetCenter: transitionLayout.targetCenter,
                  predictedSize: nextSize,
                }
          );
        } else {
          setPrimaryNodeTransition(null);
        }
      }
    }

    setSelectedNodeIds([nodeId]);
    setSelectedConnection(null);
    if (node.kind === "text-template") {
      setActiveFullNodeId(nodeId);
      setPinnedModelFullNodeId(null);
      setLibraryFullNodeId(null);
    } else if (node.kind === "model" && node.displayMode !== "resized") {
      setActiveFullNodeId(nodeId);
      setPinnedModelFullNodeId(nodeId);
      setLibraryFullNodeId(null);
    } else {
      setActiveFullNodeId(null);
      setPinnedModelFullNodeId(null);
      if (libraryFullNodeId === nodeId) {
        setLibraryFullNodeId(null);
      }
    }
  }, [
    canvasNodes,
    getCanvasSurfaceSize,
    getPlaygroundFocusSafeInsets,
    getRenderedNodeSize,
    libraryFullNodeId,
    measurePreflightNode,
    nodesById,
    prefersReducedMotion,
    primaryNodeId,
    buildRenderNodeForMeasurement,
    updateNode,
    updateViewport,
  ]);

  const focusNodeViewport = useCallback((nodeId: string) => {
    const node = canvasNodes.find((candidate) => candidate.id === nodeId);
    const surfaceElement = canvasRef.current;
    if (!node || !surfaceElement) {
      return;
    }

    const bounds = surfaceElement.getBoundingClientRect();
    if (bounds.width < 120 || bounds.height < 120) {
      return;
    }

    const nodeElement = surfaceElement.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
    const focusWidth = nodeElement?.offsetWidth || node.resolvedSize.width;
    const focusHeight = nodeElement?.offsetHeight || node.resolvedSize.height;
    updateViewport(
      buildFramedViewportForNode({
        nodePosition: { x: node.x, y: node.y },
        nodeSize: {
          width: focusWidth,
          height: focusHeight,
        },
        surfaceSize: {
          width: bounds.width,
          height: bounds.height,
        },
        safeInsets: getPlaygroundFocusSafeInsets({
          width: bounds.width,
          height: bounds.height,
        }),
      })
    );
  }, [canvasNodes, getPlaygroundFocusSafeInsets, updateViewport]);
  const transitioningPrimaryNodeId = prefersReducedMotion ? null : primaryNodeTransition?.nodeId || null;

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
          passiveTemplateEditor={libraryFullNodeId === node.id && node.kind === "text-template" && !node.presentation.isEditing}
          pickerDismissKey={`${selectedNodeIds.join(",")}|${canvasDoc.canvasViewport.x.toFixed(2)}:${canvasDoc.canvasViewport.y.toFixed(2)}:${canvasDoc.canvasViewport.zoom.toFixed(3)}|${node.presentation.renderMode}|${node.resolvedSize.width}x${node.resolvedSize.height}`}
          onSetDisplayMode={(mode) => handleNodeDisplayModeChange(node.id, mode)}
          onLabelChange={(value) => updateNode(node.id, (target) => ({ ...target, label: value }))}
          onPromptChange={(value) => updateNode(node.id, (target) => ({ ...target, prompt: value }))}
          onModelVariantChange={handleModelVariantSelection}
          onParameterChange={(parameterKey, value) =>
            updateNode(node.id, (target) => ({
              ...target,
              settings: {
                ...(target.settings as Record<string, unknown>),
                ...(value === null ? {} : { [parameterKey]: value }),
              },
            }))
          }
          onUpdateListColumnLabel={(columnId, label) =>
            updateNode(node.id, (target) => {
              const settings = getListNodeSettings(target.settings);
              return {
                ...target,
                settings: {
                  ...settings,
                  columns: settings.columns.map((column) => (column.id === columnId ? { ...column, label } : column)),
                },
              };
            })
          }
          onUpdateListCell={(rowId, columnId, value) =>
            updateNode(node.id, (target) => {
              const settings = getListNodeSettings(target.settings);
              return {
                ...target,
                settings: {
                  ...settings,
                  rows: settings.rows.map((row) =>
                    row.id === rowId ? { ...row, values: { ...row.values, [columnId]: value } } : row
                  ),
                },
              };
            })
          }
          onAddListColumn={() =>
            updateNode(node.id, (target) => {
              const settings = getListNodeSettings(target.settings);
              const columnId = `playground-column-${settings.columns.length + 1}`;
              return {
                ...target,
                settings: {
                  ...settings,
                  columns: [...settings.columns, { id: columnId, label: `Column ${settings.columns.length + 1}` }],
                  rows: settings.rows.map((row) => ({
                    ...row,
                    values: { ...row.values, [columnId]: "" },
                  })),
                },
              };
            })
          }
          onRemoveListColumn={(columnId) =>
            updateNode(node.id, (target) => {
              const settings = getListNodeSettings(target.settings);
              return {
                ...target,
                settings: {
                  ...settings,
                  columns: settings.columns.filter((column) => column.id !== columnId),
                  rows: settings.rows.map((row) => {
                    const nextValues = { ...row.values };
                    delete nextValues[columnId];
                    return {
                      ...row,
                      values: nextValues,
                    };
                  }),
                },
              };
            })
          }
          onAddListRow={(initialValues) => {
            const targetNode = nodesById[node.id];
            if (!targetNode) {
              return null;
            }
            const settings = getListNodeSettings(targetNode.settings);
            const rowId = `playground-row-${settings.rows.length + 1}`;
            updateNode(node.id, (target) => {
              const nextSettings = getListNodeSettings(target.settings);
              return {
                ...target,
                settings: {
                  ...nextSettings,
                  rows: [
                    ...nextSettings.rows,
                    {
                      id: rowId,
                      values: nextSettings.columns.reduce<Record<string, string>>((acc, column) => {
                        acc[column.id] = String(initialValues?.[column.id] ?? "");
                        return acc;
                      }, {}),
                    },
                  ],
                },
              };
            });
            return rowId;
          }}
          onRemoveListRow={(rowId) =>
            updateNode(node.id, (target) => {
              const settings = getListNodeSettings(target.settings);
              return {
                ...target,
                settings: {
                  ...settings,
                  rows: settings.rows.filter((row) => row.id !== rowId),
                },
              };
            })
          }
          onClearInputs={() =>
            updateNode(node.id, (target, allNodes) => ({
              ...target,
              promptSourceNodeId: null,
              upstreamNodeIds: [],
              upstreamAssetIds: buildAssetRefsFromNodes([], allNodes),
            }))
          }
          onDuplicateNode={() => {
            const targetNode = nodesById[node.id];
            if (!targetNode) {
              return;
            }

            const duplicateId = `playground-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setCanvasDoc((current) => ({
              ...current,
              workflow: {
                nodes: [
                  ...current.workflow.nodes,
                  {
                    ...targetNode,
                    id: duplicateId,
                    label: targetNode.label.endsWith(" Copy") ? targetNode.label : `${targetNode.label} Copy`,
                    settings: JSON.parse(JSON.stringify(targetNode.settings || {})) as WorkflowNode["settings"],
                    upstreamNodeIds: [...targetNode.upstreamNodeIds],
                    upstreamAssetIds: [...targetNode.upstreamAssetIds],
                    x: Math.round(targetNode.x + 44),
                    y: Math.round(targetNode.y + 36),
                  },
                ],
              },
            }));
            setSelectedNodeIds([duplicateId]);
            setSelectedConnection(null);
          }}
          onEnterEditMode={() => {
            void enterNodeEditMode(node.id);
          }}
          onExitEditMode={() => {
            if (activeFullNodeId === node.id) {
              setActiveFullNodeId(null);
            }
            if (pinnedModelFullNodeId === node.id) {
              setPinnedModelFullNodeId(null);
            }
          }}
          onRunNode={() => undefined}
          onOpenAssetViewer={() => undefined}
          onDownloadAssets={() => undefined}
          onOpenQueueInspect={() => undefined}
          onCommitTextEdits={() => undefined}
        />
      );
    },
    [
      activeEditor,
      buildPassiveModelEditor,
      canvasDoc.canvasViewport,
      enterNodeEditMode,
      handleModelVariantSelection,
      handleNodeDisplayModeChange,
      libraryFullNodeId,
      nodesById,
      pinnedModelFullNodeId,
      selectedNodeIds,
      updateNode,
    ]
  );

  const activePhantomPreview = useMemo<CanvasPhantomPreview | null>(() => {
    if (!selectedNode) {
      return null;
    }

    if (selectedNode.kind === "text-template") {
      if (activeFullNodeId === selectedNode.id) {
        return null;
      }

      if (!selectedTemplatePreview || selectedTemplatePreview.rows.length === 0) {
        return null;
      }

      const visibleRows = selectedTemplatePreview.rows.slice(0, 4);
      return {
        sourceNodeId: selectedNode.id,
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

    if (selectedNode.kind !== "model") {
      return null;
    }

    if (selectedNode.outputType === "text") {
      const target = readTextOutputTarget((selectedNode.settings as Record<string, unknown>).textOutputTarget);
      return {
        sourceNodeId: selectedNode.id,
        nodes: [
          {
            id: `${selectedNode.id}-phantom-text`,
            kind:
              target === "list" ? "list" : target === "template" ? "text-template" : target === "smart" ? "mystery" : "text-note",
            label:
              target === "smart"
                ? "Structured outputs"
                : target === "list"
                  ? getGeneratedDescriptorDefaultLabel("list")
                  : target === "template"
                    ? getGeneratedDescriptorDefaultLabel("text-template")
                    : getGeneratedDescriptorDefaultLabel("text-note"),
          },
        ],
        overflowCount: 0,
        runDisabledReason: null,
      };
    }

    return {
      sourceNodeId: selectedNode.id,
      nodes: [
        {
          id: `${selectedNode.id}-phantom-asset`,
          kind: "asset",
          label: "Output 1",
          width: 176,
          height: 176,
          aspectRatio: 1,
        },
      ],
      overflowCount: 0,
      runDisabledReason: null,
    };
  }, [activeFullNodeId, selectedNode, selectedTemplatePreview]);

  const connectNodes = useCallback((sourceNodeId: string, targetNodeId: string) => {
    const sourceNode = nodesById[sourceNodeId];
    const targetNode = nodesById[targetNodeId];
    if (!sourceNode || !targetNode || !canConnectCanvasNodes(sourceNode, targetNode)) {
      return;
    }

    setCanvasDoc((current) => ({
      ...current,
      workflow: {
        nodes: current.workflow.nodes.map((node) => {
          if (node.id !== targetNodeId) {
            return node;
          }

          if (targetNode.kind === "text-note") {
            return {
              ...node,
              upstreamNodeIds: [sourceNodeId],
              upstreamAssetIds: [`node:${sourceNodeId}`],
            };
          }

          if (sourceNode.kind === "text-note") {
            return {
              ...node,
              promptSourceNodeId: sourceNodeId,
            };
          }

          if (sourceNode.kind === "list") {
            return {
              ...node,
              upstreamNodeIds: [sourceNodeId],
              upstreamAssetIds: buildAssetRefsFromNodes([sourceNodeId], current.workflow.nodes),
            };
          }

          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, sourceNodeId])];
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, current.workflow.nodes),
          };
        }),
      },
    }));
  }, [nodesById]);

  return (
    <div ref={canvasRef} className={styles.playgroundCanvas}>
      <InfiniteCanvas
        nodes={canvasNodes}
        selectedNodeIds={selectedNodeIds}
        selectedConnectionId={selectedConnection?.id || null}
        viewport={canvasDoc.canvasViewport}
        onSelectSingleNode={selectSingleNode}
        onToggleNodeSelection={(nodeId) => {
          setSelectedNodeIds((current) =>
            current.includes(nodeId) ? current.filter((candidate) => candidate !== nodeId) : [...current, nodeId]
          );
        }}
        onMarqueeSelectNodes={(nodeIds) => {
          setSelectedNodeIds(nodeIds);
        }}
        onRequestInsertMenu={() => undefined}
        onDropFiles={() => undefined}
        onViewportChange={updateViewport}
        onCommitNodePositions={(positions) => {
          setCanvasDoc((current) => ({
            ...current,
            workflow: {
              nodes: current.workflow.nodes.map((node) =>
                positions[node.id]
                  ? {
                      ...node,
                      x: positions[node.id]!.x,
                      y: positions[node.id]!.y,
                    }
                  : node
              ),
            },
          }));
        }}
        onStartNodeResize={handleNodeResizeStart}
        onCommitNodeSize={handleNodeSizeCommit}
        onConnectNodes={connectNodes}
        onSelectConnection={setSelectedConnection}
        onNodeActivate={(nodeId) => {
          void enterNodeEditMode(nodeId);
        }}
        onNodeDoubleClick={(nodeId) => {
          const node = nodesById[nodeId];
          if (!node) {
            return;
          }
          if (node.kind === "asset-source" && node.outputType === "image") {
            focusNodeViewport(nodeId);
            return;
          }
          if (node.kind === "text-template") {
            void enterNodeEditMode(nodeId);
            return;
          }
          if (node.displayMode === "resized") {
            focusNodeViewport(nodeId);
            return;
          }
          if (node.kind === "model") {
            void enterNodeEditMode(nodeId);
            return;
          }
          selectSingleNode(nodeId);
        }}
        renderNodeContent={renderNodeContent}
        activePhantomPreview={activePhantomPreview}
        onRunActiveNode={() => undefined}
        selectionActions={[]}
        enableProgrammaticViewportMotion={!prefersReducedMotion}
        programmaticMotionNodeIds={transitioningPrimaryNodeId ? [transitioningPrimaryNodeId] : []}
        programmaticMotionFrameSizes={
          transitioningPrimaryNodeId && primaryNodeTransition
            ? { [transitioningPrimaryNodeId]: primaryNodeTransition.predictedSize }
            : {}
        }
      />
      <CanvasFocusPreflightLayer
        request={preflightRequest}
        renderNodeContent={renderNodeContent}
        onMeasured={resolvePreflightMeasurement}
      />
      {primaryWorkflowNode ? (
        <div className={styles.playgroundModeDock}>
          <div ref={playgroundModeDockRef} className={styles.playgroundModeRail}>
            {PLAYGROUND_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`${styles.playgroundModeButton} ${activePlaygroundMode === option.id ? styles.playgroundModeButtonActive : ""}`}
                aria-pressed={activePlaygroundMode === option.id}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  void transitionPrimaryNode(option.id);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
