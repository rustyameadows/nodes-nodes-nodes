export type AnchoredOverlayPlacement = "bottom-start" | "top-start";

export type AnchoredOverlayRect = {
  top: number;
  left: number;
  bottom: number;
  width: number;
};

export type AnchoredOverlayViewport = {
  width: number;
  height: number;
};

export type AnchoredOverlayPositionInput = {
  anchorRect: AnchoredOverlayRect;
  viewport: AnchoredOverlayViewport;
  preferredPlacement: AnchoredOverlayPlacement;
  offset: number;
  viewportPadding: number;
  minHeight: number;
  matchAnchorWidth?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
};

export type AnchoredOverlayPosition = {
  placement: AnchoredOverlayPlacement;
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

export function computeAnchoredOverlayPosition({
  anchorRect,
  viewport,
  preferredPlacement,
  offset,
  viewportPadding,
  minHeight,
  matchAnchorWidth = false,
  width,
  minWidth,
  maxWidth,
}: AnchoredOverlayPositionInput): AnchoredOverlayPosition {
  const availableWidth = Math.max(0, viewport.width - viewportPadding * 2);
  const requestedWidth = width ?? 0;
  const requestedMinWidth = minWidth ?? 0;
  const anchorWidth = matchAnchorWidth ? anchorRect.width : 0;
  const clampedWidth = Math.min(
    maxWidth ?? availableWidth,
    Math.max(requestedWidth, requestedMinWidth, anchorWidth),
    availableWidth
  );

  let left = anchorRect.left;
  if (left + clampedWidth > viewport.width - viewportPadding) {
    left = viewport.width - viewportPadding - clampedWidth;
  }
  if (left < viewportPadding) {
    left = viewportPadding;
  }

  const availableBelow = Math.max(0, viewport.height - anchorRect.bottom - viewportPadding - offset);
  const availableAbove = Math.max(0, anchorRect.top - viewportPadding - offset);
  const canFitBelow = availableBelow >= minHeight;
  const canFitAbove = availableAbove >= minHeight;

  let placement = preferredPlacement;
  if (preferredPlacement === "bottom-start" && !canFitBelow && availableAbove > availableBelow) {
    placement = "top-start";
  } else if (preferredPlacement === "top-start" && !canFitAbove && availableBelow > availableAbove) {
    placement = "bottom-start";
  }

  if (placement === "bottom-start") {
    return {
      placement,
      left,
      top: anchorRect.bottom + offset,
      width: clampedWidth,
      maxHeight: Math.max(minHeight, availableBelow),
    };
  }

  return {
    placement,
    left,
    bottom: viewport.height - anchorRect.top + offset,
    width: clampedWidth,
    maxHeight: Math.max(minHeight, availableAbove),
  };
}
