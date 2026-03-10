import type {
  Asset,
  CanvasDocument,
  ProviderModel,
  UploadedAssetNodeSettings,
  WorkflowNode,
} from "@/components/workspace/types";
import { createCanvasLocalId, nextCanvasNodePosition } from "@/lib/canvas-document";
import { isRunnableTextModel } from "@/lib/provider-model-helpers";

const CANVAS_CENTER_STAGGER_X = 44;
const CANVAS_CENTER_STAGGER_Y = 36;
const DEFAULT_BACKGROUND_VIEWPORT_WIDTH = 1440;
const DEFAULT_BACKGROUND_VIEWPORT_HEIGHT = 960;

export function outputTypeFromAssetType(type: Asset["type"]): WorkflowNode["outputType"] {
  if (type === "video") {
    return "video";
  }
  if (type === "text") {
    return "text";
  }
  return "image";
}

export function normalizeAssetNodeLabel(fileName: string, index: number) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 26)}...`;
}

export function getImportedAssetDisplayName(asset: Asset, index: number, explicitLabel?: string | null) {
  const fileName = explicitLabel?.trim() || asset.storageRef.split("/").at(-1) || "";
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed;
}

export function getImportedAssetNodeLabel(asset: Asset, index: number, explicitLabel?: string | null) {
  const fileName = getImportedAssetDisplayName(asset, index, explicitLabel);
  return normalizeAssetNodeLabel(fileName, index);
}

export function getAssetPointerNodeLabel(asset: Asset, index: number) {
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

function normalizeAssetDimension(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

export function buildUploadedAssetNodeSettings(
  asset: Asset,
  index: number,
  explicitLabel?: string | null
): UploadedAssetNodeSettings {
  return {
    source: "upload",
    assetName: getImportedAssetDisplayName(asset, index, explicitLabel),
    assetWidth: normalizeAssetDimension(asset.width),
    assetHeight: normalizeAssetDimension(asset.height),
  };
}

export function isUploadedAssetSourceNode(
  node: Pick<WorkflowNode, "kind" | "settings"> | null | undefined
): boolean {
  if (!node || node.kind !== "asset-source" || !node.settings || typeof node.settings !== "object") {
    return false;
  }

  const source = (node.settings as Record<string, unknown>).source;
  return source === "upload" || source === "uploaded";
}

export function getUploadedAssetNodeAspectRatio(
  node: Pick<WorkflowNode, "kind" | "outputType" | "settings"> | null | undefined
) {
  if (!node || node.kind !== "asset-source" || node.outputType !== "image" || !isUploadedAssetSourceNode(node)) {
    return null;
  }

  const settings = node.settings as Record<string, unknown>;
  const width = normalizeAssetDimension(settings.assetWidth);
  const height = normalizeAssetDimension(settings.assetHeight);
  if (!width || !height) {
    return null;
  }

  return width / height;
}

export function createUploadedAssetSourceNode(
  asset: Asset,
  index: number,
  options: {
    defaultProvider: Pick<ProviderModel, "providerId" | "modelId">;
    position: { x: number; y: number };
    label?: string | null;
  }
): WorkflowNode {
  const label = getImportedAssetNodeLabel(asset, index, options.label);
  return {
    id: createCanvasLocalId(),
    label,
    kind: "asset-source",
    providerId: options.defaultProvider.providerId,
    modelId: options.defaultProvider.modelId,
    nodeType: "transform",
    outputType: outputTypeFromAssetType(asset.type),
    prompt: "",
    settings: buildUploadedAssetNodeSettings(asset, index, options.label),
    sourceAssetId: asset.id,
    sourceAssetMimeType: asset.mimeType,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: Math.round(options.position.x),
    y: Math.round(options.position.y),
    displayMode: "preview",
    size: null,
  };
}

export function buildAssetRefsFromNodes(upstreamNodeIds: string[], nodes: WorkflowNode[]) {
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

export function buildCanvasViewportCenterPosition(
  canvasDocument: CanvasDocument,
  options?: {
    viewportWidth?: number;
    viewportHeight?: number;
    staggerIndex?: number;
  }
) {
  const width = options?.viewportWidth || DEFAULT_BACKGROUND_VIEWPORT_WIDTH;
  const height = options?.viewportHeight || DEFAULT_BACKGROUND_VIEWPORT_HEIGHT;
  const offsetIndex = options?.staggerIndex || 0;

  return {
    x: Math.round(
      (width / 2 - canvasDocument.canvasViewport.x) / canvasDocument.canvasViewport.zoom +
        (offsetIndex % 3) * CANVAS_CENTER_STAGGER_X
    ),
    y: Math.round(
      (height / 2 - canvasDocument.canvasViewport.y) / canvasDocument.canvasViewport.zoom +
        (Math.floor(offsetIndex / 3) % 3) * CANVAS_CENTER_STAGGER_Y
    ),
  };
}

type InsertImportedAssetsIntoCanvasDocumentOptions = {
  defaultProvider: Pick<ProviderModel, "providerId" | "modelId">;
  position?: { x: number; y: number };
  connectToModelNodeId?: string;
  assetLabels?: string[];
};

export function insertImportedAssetsIntoCanvasDocument(
  canvasDocument: CanvasDocument,
  assets: Asset[],
  options: InsertImportedAssetsIntoCanvasDocumentOptions
) {
  if (assets.length === 0) {
    return {
      canvasDocument,
      insertedNodeIds: [] as string[],
    };
  }

  const basePosition = nextCanvasNodePosition(canvasDocument.workflow.nodes.length, options.position);
  const sourceNodes = assets.map((asset, index) => {
    const explicitLabel = options.assetLabels?.[index] || "";
    return createUploadedAssetSourceNode(asset, index, {
      defaultProvider: options.defaultProvider,
      position: {
        x: basePosition.x + index * 34,
        y: basePosition.y + index * 26,
      },
      label: explicitLabel,
    });
  });

  const sourceNodeIds = sourceNodes.map((node) => node.id);
  const nextNodes = canvasDocument.workflow.nodes.map((node) => {
    if (node.id !== options.connectToModelNodeId || node.kind !== "model") {
      return node;
    }

    if (isRunnableTextModel(node.providerId, node.modelId)) {
      return node;
    }

    const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, ...sourceNodeIds])];
    return {
      ...node,
      upstreamNodeIds,
      upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, [...canvasDocument.workflow.nodes, ...sourceNodes]),
    };
  });

  return {
    canvasDocument: {
      ...canvasDocument,
      workflow: {
        nodes: [...nextNodes, ...sourceNodes],
      },
    },
    insertedNodeIds: sourceNodeIds,
  };
}

export function getImportedAssetLabelsFromPaths(filePaths: string[]) {
  return filePaths.map((filePath) => filePath.split(/[\\/]/).at(-1) || filePath);
}
