import type { WorkflowNodeDisplayMode, WorkflowNodeSize } from "@/components/workspace/types";
import type { CanvasNodeRenderMode } from "@/lib/canvas-node-presentation";
import {
  buildCanvasFocusBounds,
  buildCanvasFocusViewport,
  DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS,
  type CanvasFocusSafeInsets,
  type CanvasFocusZoomLimits,
} from "@/lib/canvas-focus";

export type NodePlaygroundMode = "compact" | "preview" | "edit" | "resize";

export function getInitialNodePlaygroundMode(
  displayMode: WorkflowNodeDisplayMode,
  opensInEdit = false
): NodePlaygroundMode {
  if (opensInEdit) {
    return "edit";
  }

  if (displayMode === "compact") {
    return "compact";
  }

  if (displayMode === "resized") {
    return "resize";
  }

  return "preview";
}

export function getActiveNodePlaygroundMode(
  persistedMode: WorkflowNodeDisplayMode,
  renderMode: CanvasNodeRenderMode
): NodePlaygroundMode {
  if (renderMode === "full") {
    return "edit";
  }

  if (renderMode === "resized") {
    return "resize";
  }

  if (persistedMode === "compact") {
    return "compact";
  }

  return "preview";
}

export function positionNodeAroundCenter(
  center: { x: number; y: number },
  size: WorkflowNodeSize
) {
  return {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
  };
}

export function preserveNodeCenterPosition(
  position: { x: number; y: number },
  currentSize: WorkflowNodeSize,
  nextSize: WorkflowNodeSize
) {
  return positionNodeAroundCenter(
    {
      x: position.x + currentSize.width / 2,
      y: position.y + currentSize.height / 2,
    },
    nextSize
  );
}

export function buildCenteredViewportForNode(input: {
  zoom: number;
  nodePosition: { x: number; y: number };
  nodeSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
}) {
  const safeInsets = {
    top: input.safeInsets?.top ?? 0,
    right: input.safeInsets?.right ?? 0,
    bottom: input.safeInsets?.bottom ?? 0,
    left: input.safeInsets?.left ?? 0,
  };
  const availableWidth = Math.max(1, input.surfaceSize.width - safeInsets.left - safeInsets.right);
  const availableHeight = Math.max(1, input.surfaceSize.height - safeInsets.top - safeInsets.bottom);
  const nodeCenterX = input.nodePosition.x + input.nodeSize.width / 2;
  const nodeCenterY = input.nodePosition.y + input.nodeSize.height / 2;

  return {
    zoom: input.zoom,
    x: safeInsets.left + availableWidth / 2 - nodeCenterX * input.zoom,
    y: safeInsets.top + availableHeight / 2 - nodeCenterY * input.zoom,
  };
}

export function buildFramedViewportForNode(input: {
  nodePosition: { x: number; y: number };
  nodeSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  return (
    buildCanvasFocusViewport({
      targetBounds: [buildCanvasFocusBounds(input.nodePosition, input.nodeSize)],
      surfaceSize: input.surfaceSize,
      safeInsets: input.safeInsets,
      zoomLimits: input.zoomLimits ?? DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS,
    })?.viewport || {
      zoom: 1,
      x: 0,
      y: 0,
    }
  );
}

export function buildNodePlaygroundTransitionLayout(input: {
  currentPosition: { x: number; y: number };
  currentSize: WorkflowNodeSize;
  nextSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  const targetCenter = {
    x: input.currentPosition.x + input.currentSize.width / 2,
    y: input.currentPosition.y + input.currentSize.height / 2,
  };
  const nodePosition = positionNodeAroundCenter(targetCenter, input.nextSize);

  return {
    targetCenter,
    nodePosition,
    viewport: buildFramedViewportForNode({
      nodePosition,
      nodeSize: input.nextSize,
      surfaceSize: input.surfaceSize,
      safeInsets: input.safeInsets,
      zoomLimits: input.zoomLimits,
    }),
  };
}

export function buildNodePlaygroundMeasuredCorrection(input: {
  targetCenter: { x: number; y: number };
  measuredSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  const nodePosition = positionNodeAroundCenter(input.targetCenter, input.measuredSize);

  return {
    nodePosition,
    viewport: buildFramedViewportForNode({
      nodePosition,
      nodeSize: input.measuredSize,
      surfaceSize: input.surfaceSize,
      safeInsets: input.safeInsets,
      zoomLimits: input.zoomLimits,
    }),
  };
}

export function shouldCorrectNodePlaygroundMeasuredSize(
  predictedSize: WorkflowNodeSize,
  measuredSize: WorkflowNodeSize,
  tolerance = 1
) {
  return (
    Math.abs(predictedSize.width - measuredSize.width) > tolerance ||
    Math.abs(predictedSize.height - measuredSize.height) > tolerance
  );
}
