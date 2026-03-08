import type {
  WorkflowNode,
  WorkflowNodeDisplayMode,
  WorkflowNodeKind,
  WorkflowNodeSize,
} from "@/components/workspace/types";

export type CanvasNodeRenderMode = WorkflowNodeDisplayMode | "full";

export type ResolvedCanvasNodePresentation = {
  persistedMode: WorkflowNodeDisplayMode;
  renderMode: CanvasNodeRenderMode;
  canResize: boolean;
  lockAspectRatio: boolean;
  size: WorkflowNodeSize;
};

const MIN_TEXT_NOTE_SIZE: WorkflowNodeSize = { width: 244, height: 152 };
const MIN_LIST_SIZE: WorkflowNodeSize = { width: 520, height: 320 };
const MIN_TEMPLATE_SIZE: WorkflowNodeSize = { width: 420, height: 300 };
const MIN_ASSET_SIZE: WorkflowNodeSize = { width: 196, height: 196 };

export function normalizeWorkflowNodeDisplayMode(
  value: unknown,
  fallback: WorkflowNodeDisplayMode = "preview"
): WorkflowNodeDisplayMode {
  if (value === "compact" || value === "resized" || value === "preview") {
    return value;
  }

  return fallback;
}

export function normalizeWorkflowNodeSize(value: unknown): WorkflowNodeSize | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const width = typeof record.width === "number" && Number.isFinite(record.width) ? Math.round(record.width) : null;
  const height = typeof record.height === "number" && Number.isFinite(record.height) ? Math.round(record.height) : null;

  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function canResizeWorkflowNode(node: Pick<WorkflowNode, "kind">) {
  return node.kind === "text-note" || node.kind === "list" || node.kind === "text-template" || node.kind === "asset-source";
}

export function doesWorkflowNodeLockAspectRatio(node: Pick<WorkflowNode, "kind" | "outputType">) {
  return node.kind === "asset-source" && node.outputType === "image";
}

export function getWorkflowNodeMinimumSize(
  node: Pick<WorkflowNode, "kind" | "outputType">,
  aspectRatio = 1
): WorkflowNodeSize {
  if (node.kind === "text-note") {
    return MIN_TEXT_NOTE_SIZE;
  }

  if (node.kind === "list") {
    return MIN_LIST_SIZE;
  }

  if (node.kind === "text-template") {
    return MIN_TEMPLATE_SIZE;
  }

  if (node.kind === "asset-source") {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    if (safeAspectRatio >= 1) {
      return {
        width: Math.max(MIN_ASSET_SIZE.width, Math.round(MIN_ASSET_SIZE.height * safeAspectRatio)),
        height: MIN_ASSET_SIZE.height,
      };
    }
    return {
      width: MIN_ASSET_SIZE.width,
      height: Math.max(MIN_ASSET_SIZE.height, Math.round(MIN_ASSET_SIZE.width / safeAspectRatio)),
    };
  }

  return { width: 172, height: 48 };
}

export function getWorkflowNodeDefaultSize(
  kind: WorkflowNodeKind,
  renderMode: CanvasNodeRenderMode,
  aspectRatio = 1
): WorkflowNodeSize {
  if (kind === "model") {
    if (renderMode === "compact") {
      return { width: 168, height: 48 };
    }
    if (renderMode === "full") {
      return { width: 980, height: 336 };
    }
    return { width: 236, height: 84 };
  }

  if (kind === "text-note") {
    if (renderMode === "compact") {
      return { width: 148, height: 42 };
    }
    if (renderMode === "full") {
      return { width: 340, height: 244 };
    }
    return MIN_TEXT_NOTE_SIZE;
  }

  if (kind === "list") {
    if (renderMode === "compact") {
      return { width: 156, height: 46 };
    }
    if (renderMode === "full") {
      return { width: 840, height: 500 };
    }
    return { width: 320, height: 214 };
  }

  if (kind === "text-template") {
    if (renderMode === "compact") {
      return { width: 172, height: 46 };
    }
    if (renderMode === "full") {
      return { width: 720, height: 420 };
    }
    return { width: 264, height: 182 };
  }

  if (kind === "asset-source") {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    if (renderMode === "compact") {
      return safeAspectRatio >= 1 ? { width: 112, height: 72 } : { width: 72, height: 112 };
    }
    const longEdge = renderMode === "full" ? 336 : 260;
    if (safeAspectRatio >= 1) {
      return {
        width: longEdge,
        height: Math.max(140, Math.round(longEdge / safeAspectRatio)),
      };
    }
    return {
      width: Math.max(140, Math.round(longEdge * safeAspectRatio)),
      height: longEdge,
    };
  }

  return { width: 220, height: 76 };
}

export function clampWorkflowNodeSize(
  node: Pick<WorkflowNode, "kind" | "outputType">,
  size: WorkflowNodeSize,
  aspectRatio = 1
): WorkflowNodeSize {
  const minimum = getWorkflowNodeMinimumSize(node, aspectRatio);
  return {
    width: Math.max(minimum.width, Math.round(size.width)),
    height: Math.max(minimum.height, Math.round(size.height)),
  };
}

export function resolveCanvasNodePresentation(input: {
  node: Pick<WorkflowNode, "kind" | "outputType" | "displayMode" | "size">;
  activeNodeId: string | null;
  fullNodeId: string | null;
  nodeId: string;
  aspectRatio?: number;
}): ResolvedCanvasNodePresentation {
  const persistedMode = normalizeWorkflowNodeDisplayMode(input.node.displayMode);
  const renderMode =
    input.fullNodeId === input.nodeId ? ("full" as const) : persistedMode;
  const lockAspectRatio = doesWorkflowNodeLockAspectRatio(input.node);
  const canResize = canResizeWorkflowNode(input.node);
  const defaultSize = getWorkflowNodeDefaultSize(input.node.kind, renderMode, input.aspectRatio);

  if (renderMode === "resized" && input.node.size) {
    return {
      persistedMode,
      renderMode,
      canResize,
      lockAspectRatio,
      size: clampWorkflowNodeSize(input.node, input.node.size, input.aspectRatio),
    };
  }

  return {
    persistedMode,
    renderMode,
    canResize,
    lockAspectRatio,
    size: defaultSize,
  };
}
