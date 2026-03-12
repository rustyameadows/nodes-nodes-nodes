import type { WorkflowNodeSize } from "@/components/workspace/types";

export type CanvasFocusBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasFocusSafeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CanvasFocusZoomLimits = {
  min: number;
  max: number;
};

export type CanvasFocusViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasFocusRequestAnchor = "available-center" | "camera-only";

export type CanvasFocusRequest = {
  nodeIds: string[];
  predictedBoundsById?: Record<string, CanvasFocusBounds>;
  anchor?: CanvasFocusRequestAnchor;
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  modeChange?: {
    nodeId: string;
    predictedSize: WorkflowNodeSize;
    targetCenter?: { x: number; y: number };
  };
};

export const DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS: CanvasFocusZoomLimits = {
  min: 0.35,
  max: 2.4,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildCanvasFocusAvailableRect(
  surfaceSize: { width: number; height: number },
  safeInsets?: Partial<CanvasFocusSafeInsets>
) {
  const resolvedSafeInsets: CanvasFocusSafeInsets = {
    top: safeInsets?.top ?? 0,
    right: safeInsets?.right ?? 0,
    bottom: safeInsets?.bottom ?? 0,
    left: safeInsets?.left ?? 0,
  };

  return {
    safeInsets: resolvedSafeInsets,
    rect: {
      x: resolvedSafeInsets.left,
      y: resolvedSafeInsets.top,
      width: Math.max(1, surfaceSize.width - resolvedSafeInsets.left - resolvedSafeInsets.right),
      height: Math.max(1, surfaceSize.height - resolvedSafeInsets.top - resolvedSafeInsets.bottom),
    },
  };
}

export function getCanvasFocusAvailableCenter(
  surfaceSize: { width: number; height: number },
  safeInsets?: Partial<CanvasFocusSafeInsets>
) {
  const available = buildCanvasFocusAvailableRect(surfaceSize, safeInsets).rect;
  return {
    x: available.x + available.width / 2,
    y: available.y + available.height / 2,
  };
}

export function getCanvasFocusWorldCenterAtAvailableCenter(input: {
  viewport: CanvasFocusViewport;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
}) {
  const availableCenter = getCanvasFocusAvailableCenter(input.surfaceSize, input.safeInsets);
  return {
    x: (availableCenter.x - input.viewport.x) / input.viewport.zoom,
    y: (availableCenter.y - input.viewport.y) / input.viewport.zoom,
  };
}

export function buildCanvasFocusBounds(
  position: { x: number; y: number },
  size: WorkflowNodeSize
): CanvasFocusBounds {
  return {
    x: position.x,
    y: position.y,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
  };
}

export function positionCanvasFocusBoundsAroundCenter(
  center: { x: number; y: number },
  size: WorkflowNodeSize
) {
  return {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
  };
}

export function preserveCanvasFocusCenterPosition(
  position: { x: number; y: number },
  currentSize: WorkflowNodeSize,
  nextSize: WorkflowNodeSize
) {
  return positionCanvasFocusBoundsAroundCenter(
    {
      x: position.x + currentSize.width / 2,
      y: position.y + currentSize.height / 2,
    },
    nextSize
  );
}

export function getCanvasFocusUnionBounds(bounds: CanvasFocusBounds[]): CanvasFocusBounds | null {
  if (bounds.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const bound of bounds) {
    minX = Math.min(minX, bound.x);
    minY = Math.min(minY, bound.y);
    maxX = Math.max(maxX, bound.x + Math.max(1, bound.width));
    maxY = Math.max(maxY, bound.y + Math.max(1, bound.height));
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function buildCanvasFocusViewport(input: {
  targetBounds: CanvasFocusBounds[];
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}): {
  viewport: CanvasFocusViewport;
  unionBounds: CanvasFocusBounds;
  center: { x: number; y: number };
  availableRect: { x: number; y: number; width: number; height: number };
} | null {
  const unionBounds = getCanvasFocusUnionBounds(input.targetBounds);
  if (!unionBounds) {
    return null;
  }

  const zoomLimits = input.zoomLimits ?? DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS;
  const availableRect = buildCanvasFocusAvailableRect(input.surfaceSize, input.safeInsets).rect;
  const availableWidth = availableRect.width;
  const availableHeight = availableRect.height;
  const fitZoom = Math.min(
    availableWidth / Math.max(1, unionBounds.width),
    availableHeight / Math.max(1, unionBounds.height)
  );
  const zoom = clamp(fitZoom, zoomLimits.min, zoomLimits.max);
  const center = {
    x: unionBounds.x + unionBounds.width / 2,
    y: unionBounds.y + unionBounds.height / 2,
  };

  return {
    unionBounds,
    center,
    availableRect,
    viewport: {
      zoom,
      x: availableRect.x + availableRect.width / 2 - center.x * zoom,
      y: availableRect.y + availableRect.height / 2 - center.y * zoom,
    },
  };
}

export function buildCanvasFocusTransitionLayout(input: {
  currentViewport?: CanvasFocusViewport;
  currentPosition: { x: number; y: number };
  currentSize: WorkflowNodeSize;
  nextSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  const targetCenter = input.currentViewport
    ? getCanvasFocusWorldCenterAtAvailableCenter({
        viewport: input.currentViewport,
        surfaceSize: input.surfaceSize,
        safeInsets: input.safeInsets,
      })
    : {
        x: input.currentPosition.x + input.currentSize.width / 2,
        y: input.currentPosition.y + input.currentSize.height / 2,
      };
  const nodePosition = positionCanvasFocusBoundsAroundCenter(targetCenter, input.nextSize);

  return {
    targetCenter,
    nodePosition,
    viewport:
      buildCanvasFocusViewport({
        targetBounds: [buildCanvasFocusBounds(nodePosition, input.nextSize)],
        surfaceSize: input.surfaceSize,
        safeInsets: input.safeInsets,
        zoomLimits: input.zoomLimits ?? DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS,
      })?.viewport || {
        zoom: 1,
        x: 0,
        y: 0,
      },
  };
}

export function buildCanvasFocusMeasuredCorrection(input: {
  targetCenter: { x: number; y: number };
  measuredSize: WorkflowNodeSize;
  surfaceSize: { width: number; height: number };
  safeInsets?: Partial<CanvasFocusSafeInsets>;
  zoomLimits?: CanvasFocusZoomLimits;
}) {
  const nodePosition = positionCanvasFocusBoundsAroundCenter(input.targetCenter, input.measuredSize);

  return {
    nodePosition,
    viewport:
      buildCanvasFocusViewport({
        targetBounds: [buildCanvasFocusBounds(nodePosition, input.measuredSize)],
        surfaceSize: input.surfaceSize,
        safeInsets: input.safeInsets,
        zoomLimits: input.zoomLimits ?? DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS,
      })?.viewport || {
        zoom: 1,
        x: 0,
        y: 0,
      },
  };
}

export function shouldCorrectCanvasFocusMeasuredSize(
  predictedSize: WorkflowNodeSize,
  measuredSize: WorkflowNodeSize,
  tolerance = 1
) {
  return (
    Math.abs(predictedSize.width - measuredSize.width) > tolerance ||
    Math.abs(predictedSize.height - measuredSize.height) > tolerance
  );
}
