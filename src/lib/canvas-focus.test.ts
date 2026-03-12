import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanvasFocusAvailableRect,
  buildCanvasFocusBounds,
  buildCanvasFocusMeasuredCorrection,
  buildCanvasFocusTransitionLayout,
  buildCanvasFocusViewport,
  getCanvasFocusAvailableCenter,
  getCanvasFocusWorldCenterAtAvailableCenter,
  getCanvasFocusUnionBounds,
  positionCanvasFocusBoundsAroundCenter,
  preserveCanvasFocusCenterPosition,
  shouldCorrectCanvasFocusMeasuredSize,
} from "@/lib/canvas-focus";

test("getCanvasFocusUnionBounds returns the outer union for multiple targets", () => {
  const union = getCanvasFocusUnionBounds([
    { x: 180, y: 120, width: 320, height: 214 },
    { x: 620, y: 90, width: 260, height: 320 },
  ]);

  assert.deepEqual(union, {
    x: 180,
    y: 90,
    width: 700,
    height: 320,
  });
});

test("buildCanvasFocusViewport centers and fit-zooms a single target inside safe insets", () => {
  const result = buildCanvasFocusViewport({
    targetBounds: [buildCanvasFocusBounds({ x: 180, y: 120 }, { width: 760, height: 460 })],
    surfaceSize: { width: 960, height: 720 },
    safeInsets: { top: 44, right: 52, bottom: 108, left: 52 },
  });

  assert.ok(result);
  assert.deepEqual(result?.unionBounds, {
    x: 180,
    y: 120,
    width: 760,
    height: 460,
  });
  assert.deepEqual(result?.center, {
    x: 560,
    y: 350,
  });
  assert.deepEqual(result?.viewport, {
    zoom: 1.1263157894736842,
    x: -150.73684210526312,
    y: -66.21052631578948,
  });
});

test("buildCanvasFocusViewport fits the union bounds for multi-node selections", () => {
  const result = buildCanvasFocusViewport({
    targetBounds: [
      { x: 180, y: 120, width: 320, height: 214 },
      { x: 620, y: 90, width: 260, height: 320 },
    ],
    surfaceSize: { width: 1280, height: 800 },
    safeInsets: { top: 48, right: 56, bottom: 96, left: 56 },
  });

  assert.ok(result);
  assert.deepEqual(result?.unionBounds, {
    x: 180,
    y: 90,
    width: 700,
    height: 320,
  });
  assert.deepEqual(result?.viewport, {
    zoom: 1.6685714285714286,
    x: -244.34285714285716,
    y: -41.14285714285717,
  });
});

test("buildCanvasFocusViewport honors safe insets when centering the target bounds", () => {
  const result = buildCanvasFocusViewport({
    targetBounds: [buildCanvasFocusBounds({ x: 48, y: 72 }, { width: 640, height: 420 })],
    surfaceSize: { width: 920, height: 948 },
    safeInsets: { top: 40, right: 40, bottom: 148, left: 40 },
  });

  assert.ok(result);
  const availableCenterX = result!.availableRect.x + result!.availableRect.width / 2;
  const availableCenterY = result!.availableRect.y + result!.availableRect.height / 2;
  const targetCenterX = (result!.unionBounds.x + result!.unionBounds.width / 2) * result!.viewport.zoom + result!.viewport.x;
  const targetCenterY = (result!.unionBounds.y + result!.unionBounds.height / 2) * result!.viewport.zoom + result!.viewport.y;

  assert.equal(targetCenterX, availableCenterX);
  assert.equal(targetCenterY, availableCenterY);
});

test("buildCanvasFocusAvailableRect and center reflect live safe insets", () => {
  const available = buildCanvasFocusAvailableRect(
    { width: 920, height: 948 },
    { top: 40, right: 40, bottom: 148, left: 40 }
  );

  assert.deepEqual(available.rect, {
    x: 40,
    y: 40,
    width: 840,
    height: 760,
  });
  assert.deepEqual(getCanvasFocusAvailableCenter(
    { width: 920, height: 948 },
    { top: 40, right: 40, bottom: 148, left: 40 }
  ), {
    x: 460,
    y: 420,
  });
});

test("getCanvasFocusWorldCenterAtAvailableCenter maps the current viewport center back into world space", () => {
  const worldCenter = getCanvasFocusWorldCenterAtAvailableCenter({
    viewport: { x: 100, y: -30, zoom: 1.2 },
    surfaceSize: { width: 920, height: 948 },
    safeInsets: { top: 40, right: 40, bottom: 148, left: 40 },
  });

  assert.deepEqual(worldCenter, {
    x: 300,
    y: 375,
  });
});

test("preserveCanvasFocusCenterPosition keeps the node center stable while the shell size changes", () => {
  const nextPosition = preserveCanvasFocusCenterPosition(
    { x: 120, y: 180 },
    { width: 236, height: 84 },
    { width: 980, height: 385 }
  );

  assert.deepEqual(nextPosition, { x: -252, y: 30 });
});

test("positionCanvasFocusBoundsAroundCenter converts a target center into top-left bounds", () => {
  const position = positionCanvasFocusBoundsAroundCenter(
    { x: 238, y: 222 },
    { width: 320, height: 320 }
  );

  assert.deepEqual(position, { x: 78, y: 62 });
});

test("buildCanvasFocusTransitionLayout re-anchors around the live available viewport center", () => {
  const layout = buildCanvasFocusTransitionLayout({
    currentViewport: { x: 100, y: -30, zoom: 1.2 },
    currentPosition: { x: 120, y: 180 },
    currentSize: { width: 236, height: 84 },
    nextSize: { width: 640, height: 420 },
    surfaceSize: { width: 920, height: 948 },
    safeInsets: { top: 40, right: 40, bottom: 148, left: 40 },
  });

  assert.deepEqual(layout.targetCenter, { x: 300, y: 375 });
  assert.deepEqual(layout.nodePosition, { x: -20, y: 165 });
  assert.deepEqual(layout.viewport, {
    zoom: 1.3125,
    x: 66.25,
    y: -72.1875,
  });
});

test("buildCanvasFocusMeasuredCorrection recenters measured size drift without changing the target center", () => {
  const correction = buildCanvasFocusMeasuredCorrection({
    targetCenter: { x: 238, y: 222 },
    measuredSize: { width: 612, height: 392 },
    surfaceSize: { width: 920, height: 948 },
    safeInsets: { top: 40, right: 40, bottom: 148, left: 40 },
  });

  assert.deepEqual(correction.nodePosition, { x: -68, y: 26 });
  assert.deepEqual(correction.viewport, {
    zoom: 1.3725490196078431,
    x: 133.33333333333331,
    y: 115.29411764705884,
  });
});

test("shouldCorrectCanvasFocusMeasuredSize only flags meaningful size drift", () => {
  assert.equal(
    shouldCorrectCanvasFocusMeasuredSize(
      { width: 640, height: 420 },
      { width: 640, height: 420 }
    ),
    false
  );
  assert.equal(
    shouldCorrectCanvasFocusMeasuredSize(
      { width: 640, height: 420 },
      { width: 641, height: 420 }
    ),
    false
  );
  assert.equal(
    shouldCorrectCanvasFocusMeasuredSize(
      { width: 640, height: 420 },
      { width: 644, height: 420 }
    ),
    true
  );
});
