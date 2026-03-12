import type { WorkflowNodeDisplayMode, WorkflowNodeSize } from "@/components/workspace/types";
import type { CanvasNodeRenderMode } from "@/lib/canvas-node-presentation";
import {
  buildCanvasFocusBounds,
  buildCanvasFocusMeasuredCorrection,
  buildCanvasFocusTransitionLayout,
  buildCanvasFocusViewport,
  DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS,
  positionCanvasFocusBoundsAroundCenter,
  preserveCanvasFocusCenterPosition,
  shouldCorrectCanvasFocusMeasuredSize,
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

  if (displayMode === "full") {
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
  return positionCanvasFocusBoundsAroundCenter(center, size);
}

export function preserveNodeCenterPosition(
  position: { x: number; y: number },
  currentSize: WorkflowNodeSize,
  nextSize: WorkflowNodeSize
) {
  return preserveCanvasFocusCenterPosition(position, currentSize, nextSize);
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
  currentViewport?: { x: number; y: number; zoom: number };
  currentPosition: { x: number; y: number };
  currentSize: WorkflowNodeSize;
  nextSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  return buildCanvasFocusTransitionLayout(input);
}

export function buildNodePlaygroundMeasuredCorrection(input: {
  targetCenter: { x: number; y: number };
  measuredSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  return buildCanvasFocusMeasuredCorrection(input);
}

export function shouldCorrectNodePlaygroundMeasuredSize(
  predictedSize: WorkflowNodeSize,
  measuredSize: WorkflowNodeSize,
  tolerance = 1
) {
  return shouldCorrectCanvasFocusMeasuredSize(predictedSize, measuredSize, tolerance);
}
