import assert from "node:assert/strict";
import test from "node:test";
import { computeAnchoredOverlayPosition } from "./anchored-overlay";

test("anchored overlay clamps width to the viewport and keeps the trigger visible", () => {
  const position = computeAnchoredOverlayPosition({
    anchorRect: {
      top: 120,
      left: 580,
      bottom: 156,
      width: 180,
    },
    viewport: {
      width: 720,
      height: 900,
    },
    preferredPlacement: "bottom-start",
    offset: 10,
    viewportPadding: 14,
    minHeight: 180,
    matchAnchorWidth: true,
    width: 420,
    maxWidth: 520,
  });

  assert.equal(position.width, 420);
  assert.equal(position.left, 286);
  assert.equal(position.placement, "bottom-start");
  assert.equal(position.top, 166);
});

test("anchored overlay flips above when there is not enough room below", () => {
  const position = computeAnchoredOverlayPosition({
    anchorRect: {
      top: 700,
      left: 120,
      bottom: 744,
      width: 240,
    },
    viewport: {
      width: 1024,
      height: 820,
    },
    preferredPlacement: "bottom-start",
    offset: 12,
    viewportPadding: 16,
    minHeight: 220,
    matchAnchorWidth: true,
    minWidth: 320,
    maxWidth: 560,
  });

  assert.equal(position.placement, "top-start");
  assert.equal(position.bottom, 132);
  assert.equal(position.width, 320);
  assert.equal(position.maxHeight, 672);
});
