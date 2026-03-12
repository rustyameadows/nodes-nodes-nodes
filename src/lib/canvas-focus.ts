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

export const DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS: CanvasFocusZoomLimits = {
  min: 0.35,
  max: 2.4,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

  const safeInsets: CanvasFocusSafeInsets = {
    top: input.safeInsets?.top ?? 0,
    right: input.safeInsets?.right ?? 0,
    bottom: input.safeInsets?.bottom ?? 0,
    left: input.safeInsets?.left ?? 0,
  };
  const zoomLimits = input.zoomLimits ?? DEFAULT_CANVAS_FOCUS_ZOOM_LIMITS;
  const availableWidth = Math.max(1, input.surfaceSize.width - safeInsets.left - safeInsets.right);
  const availableHeight = Math.max(1, input.surfaceSize.height - safeInsets.top - safeInsets.bottom);
  const fitZoom = Math.min(
    availableWidth / Math.max(1, unionBounds.width),
    availableHeight / Math.max(1, unionBounds.height)
  );
  const zoom = clamp(fitZoom, zoomLimits.min, zoomLimits.max);
  const center = {
    x: unionBounds.x + unionBounds.width / 2,
    y: unionBounds.y + unionBounds.height / 2,
  };
  const availableRect = {
    x: safeInsets.left,
    y: safeInsets.top,
    width: availableWidth,
    height: availableHeight,
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
