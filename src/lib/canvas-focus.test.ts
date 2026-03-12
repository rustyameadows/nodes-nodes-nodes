import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanvasFocusBounds,
  buildCanvasFocusViewport,
  getCanvasFocusUnionBounds,
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
