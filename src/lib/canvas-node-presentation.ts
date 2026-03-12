import type {
  WorkflowNode,
  WorkflowNodeDisplayMode,
  WorkflowNodeKind,
  WorkflowNodeSize,
} from "@/components/workspace/types";

export type CanvasNodeRenderMode = WorkflowNodeDisplayMode | "full";

export type CanvasNodeInteractionPolicy =
  | "model"
  | "text-note"
  | "list"
  | "text-template"
  | "image-asset"
  | "asset";

export type ResolvedCanvasNodePresentation = {
  persistedMode: WorkflowNodeDisplayMode;
  renderMode: CanvasNodeRenderMode;
  canResize: boolean;
  showResizeHandle: boolean;
  lockAspectRatio: boolean;
  size: WorkflowNodeSize;
  interactionPolicy: CanvasNodeInteractionPolicy;
  isActive: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  showTitleRail: boolean;
  showActionRail: boolean;
  showExternalBadges: boolean;
  useRailDragHandle: boolean;
};

const MIN_MODEL_SIZE: WorkflowNodeSize = { width: 460, height: 320 };
const MIN_TEXT_NOTE_SIZE: WorkflowNodeSize = { width: 244, height: 152 };
const MIN_TEMPLATE_SIZE: WorkflowNodeSize = { width: 420, height: 300 };
const MIN_ASSET_SIZE: WorkflowNodeSize = { width: 196, height: 196 };

export function normalizeWorkflowNodeDisplayMode(
  value: unknown,
  fallback: WorkflowNodeDisplayMode = "preview"
): WorkflowNodeDisplayMode {
  if (value === "compact" || value === "full" || value === "resized" || value === "preview") {
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
  return (
    node.kind === "model" ||
    node.kind === "text-note" ||
    node.kind === "list" ||
    node.kind === "text-template" ||
    node.kind === "asset-source"
  );
}

export function doesWorkflowNodeLockAspectRatio(node: Pick<WorkflowNode, "kind" | "outputType">) {
  return node.kind === "asset-source" && node.outputType === "image";
}

export function getWorkflowNodeResizeMinimumSize(
  node: Pick<WorkflowNode, "kind" | "outputType">,
  aspectRatio = 1
): WorkflowNodeSize {
  if (node.kind === "model") {
    return MIN_MODEL_SIZE;
  }

  if (node.kind === "text-note") {
    return MIN_TEXT_NOTE_SIZE;
  }

  if (node.kind === "list") {
    return getWorkflowNodeDefaultSize("list", "compact");
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
      return { width: 980, height: 385 };
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

export function getCanvasNodeInteractionPolicy(
  node: Pick<WorkflowNode, "kind" | "outputType">
): CanvasNodeInteractionPolicy {
  if (node.kind === "model") {
    return "model";
  }

  if (node.kind === "text-note") {
    return "text-note";
  }

  if (node.kind === "list") {
    return "list";
  }

  if (node.kind === "text-template") {
    return "text-template";
  }

  if (node.kind === "asset-source" && node.outputType === "image") {
    return "image-asset";
  }

  return "asset";
}

export function clampWorkflowNodeSize(
  node: Pick<WorkflowNode, "kind" | "outputType">,
  size: WorkflowNodeSize,
  aspectRatio = 1
): WorkflowNodeSize {
  const minimum = getWorkflowNodeResizeMinimumSize(node, aspectRatio);
  return {
    width: Math.max(minimum.width, Math.round(size.width)),
    height: Math.max(minimum.height, Math.round(size.height)),
  };
}

export function shouldCanvasNodeMeasureContentHeight(input: {
  kind: WorkflowNode["kind"];
  renderMode: CanvasNodeRenderMode;
}) {
  return input.kind === "model" && input.renderMode === "full";
}

export function resolveCanvasNodeFrameSize(input: {
  kind: WorkflowNode["kind"];
  renderMode: CanvasNodeRenderMode;
  resolvedSize?: WorkflowNodeSize | null;
  measuredSize?: WorkflowNodeSize | null;
  resizeDraftSize?: WorkflowNodeSize | null;
  fallbackSize: WorkflowNodeSize;
}): WorkflowNodeSize {
  if (input.resizeDraftSize) {
    return input.resizeDraftSize;
  }

  if (input.resolvedSize) {
    if (shouldCanvasNodeMeasureContentHeight(input) && input.measuredSize) {
      return {
        width: input.resolvedSize.width,
        height: input.measuredSize.height,
      };
    }

    return input.resolvedSize;
  }

  if (input.measuredSize) {
    return input.measuredSize;
  }

  return input.fallbackSize;
}

export function resolveCanvasNodePresentation(input: {
  node: Pick<WorkflowNode, "kind" | "outputType" | "displayMode" | "size">;
  activeNodeId: string | null;
  fullNodeId: string | null;
  nodeId: string;
  aspectRatio?: number;
  forcedRenderMode?: CanvasNodeRenderMode | null;
}): ResolvedCanvasNodePresentation {
  const persistedMode = normalizeWorkflowNodeDisplayMode(input.node.displayMode);
  const interactionPolicy = getCanvasNodeInteractionPolicy(input.node);
  const isActive = input.activeNodeId === input.nodeId;
  const isEditing = input.fullNodeId === input.nodeId && interactionPolicy === "text-template";
  const isModelFullOpen =
    input.fullNodeId === input.nodeId &&
    interactionPolicy === "model" &&
    persistedMode !== "resized" &&
    persistedMode !== "full";
  let renderMode: CanvasNodeRenderMode = persistedMode;

  if (input.forcedRenderMode === "full") {
    renderMode = "full";
  } else if (input.forcedRenderMode === "resized") {
    renderMode = "resized";
  } else if (isModelFullOpen) {
    renderMode = "full";
  } else if (interactionPolicy === "text-template" && isEditing) {
    renderMode = persistedMode === "resized" ? "resized" : "full";
  }

  const lockAspectRatio = doesWorkflowNodeLockAspectRatio(input.node);
  const canResize = canResizeWorkflowNode(input.node);
  const defaultSize = getWorkflowNodeDefaultSize(input.node.kind, renderMode, input.aspectRatio);
  const keepsExpandedShellWhenInactive =
    interactionPolicy === "model" && (isModelFullOpen || persistedMode === "full" || persistedMode === "resized");
  const isExpanded = isActive || isEditing || keepsExpandedShellWhenInactive;
  const showModelChrome = interactionPolicy === "model" ? isActive : isExpanded;
  const showResizeHandle =
    canResize &&
    renderMode !== "compact" &&
    (interactionPolicy === "model" ? isActive : isExpanded);

  if (renderMode === "resized" && input.node.size) {
    return {
      persistedMode,
      renderMode,
      canResize,
      showResizeHandle,
      lockAspectRatio,
      interactionPolicy,
      isActive,
      isEditing,
      isExpanded,
      showTitleRail: showModelChrome,
      showActionRail: showModelChrome,
      showExternalBadges: showModelChrome,
      useRailDragHandle: showModelChrome,
      size: clampWorkflowNodeSize(input.node, input.node.size, input.aspectRatio),
    };
  }

  return {
    persistedMode,
    renderMode,
    canResize,
    showResizeHandle,
    lockAspectRatio,
    interactionPolicy,
    isActive,
    isEditing,
    isExpanded,
    showTitleRail: showModelChrome,
    showActionRail: showModelChrome,
    showExternalBadges: showModelChrome,
    useRailDragHandle: showModelChrome,
    size: defaultSize,
  };
}
