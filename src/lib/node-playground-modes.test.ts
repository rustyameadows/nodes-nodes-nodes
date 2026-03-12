import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNodePlaygroundMeasuredCorrection,
  buildNodePlaygroundTransitionLayout,
  buildCenteredViewportForNode,
  buildFramedViewportForNode,
  getActiveNodePlaygroundMode,
  getInitialNodePlaygroundMode,
  positionNodeAroundCenter,
  preserveNodeCenterPosition,
  shouldCorrectNodePlaygroundMeasuredSize,
} from "@/lib/node-playground-modes";

test("initial node playground modes derive from persisted display mode unless the fixture opens in edit", () => {
  assert.equal(getInitialNodePlaygroundMode("preview"), "preview");
  assert.equal(getInitialNodePlaygroundMode("compact"), "compact");
  assert.equal(getInitialNodePlaygroundMode("resized"), "resize");
  assert.equal(getInitialNodePlaygroundMode("preview", true), "edit");
});

test("active node playground mode prefers full and resized render states over persisted metadata", () => {
  assert.equal(getActiveNodePlaygroundMode("preview", "preview"), "preview");
  assert.equal(getActiveNodePlaygroundMode("compact", "compact"), "compact");
  assert.equal(getActiveNodePlaygroundMode("preview", "full"), "edit");
  assert.equal(getActiveNodePlaygroundMode("preview", "resized"), "resize");
});

test("preserveNodeCenterPosition keeps the node center stable while the shell size changes", () => {
  const nextPosition = preserveNodeCenterPosition(
    { x: 120, y: 180 },
    { width: 236, height: 84 },
    { width: 980, height: 385 }
  );

  assert.deepEqual(nextPosition, { x: -252, y: 30 });
});

test("positionNodeAroundCenter converts a target center back into the matching top-left position", () => {
  const position = positionNodeAroundCenter(
    { x: 238, y: 222 },
    { width: 320, height: 320 }
  );

  assert.deepEqual(position, { x: 78, y: 62 });
});

test("buildCenteredViewportForNode centers the node inside the available surface without changing zoom", () => {
  const viewport = buildCenteredViewportForNode({
    zoom: 0.8,
    nodePosition: { x: 180, y: 120 },
    nodeSize: { width: 760, height: 460 },
    surfaceSize: { width: 960, height: 720 },
    safeInsets: { top: 44, right: 52, bottom: 108, left: 52 },
  });

  assert.deepEqual(viewport, {
    zoom: 0.8,
    x: 32,
    y: 48,
  });
});

test("buildFramedViewportForNode fits and centers the node with playground padding", () => {
  const viewport = buildFramedViewportForNode({
    nodePosition: { x: 180, y: 120 },
    nodeSize: { width: 760, height: 460 },
    surfaceSize: { width: 960, height: 720 },
    safeInsets: { top: 44, right: 52, bottom: 108, left: 52 },
  });

  assert.deepEqual(viewport, {
    zoom: 1.1263157894736842,
    x: -150.73684210526312,
    y: -66.21052631578948,
  });
});

test("buildNodePlaygroundTransitionLayout keeps the node center stable while reframing the viewport", () => {
  const layout = buildNodePlaygroundTransitionLayout({
    currentPosition: { x: 120, y: 180 },
    currentSize: { width: 236, height: 84 },
    nextSize: { width: 640, height: 420 },
    surfaceSize: { width: 920, height: 948 },
    safeInsets: { top: 40, right: 40, bottom: 148, left: 40 },
  });

  assert.deepEqual(layout.targetCenter, { x: 238, y: 222 });
  assert.deepEqual(layout.nodePosition, { x: -82, y: 12 });
  assert.deepEqual(layout.viewport, {
    zoom: 1.3125,
    x: 147.625,
    y: 128.625,
  });
});

test("buildNodePlaygroundMeasuredCorrection recenters measured size drift without changing the target center", () => {
  const correction = buildNodePlaygroundMeasuredCorrection({
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

test("shouldCorrectNodePlaygroundMeasuredSize only flags meaningful size drift", () => {
  assert.equal(
    shouldCorrectNodePlaygroundMeasuredSize(
      { width: 640, height: 420 },
      { width: 640, height: 420 }
    ),
    false
  );
  assert.equal(
    shouldCorrectNodePlaygroundMeasuredSize(
      { width: 640, height: 420 },
      { width: 641, height: 420 }
    ),
    false
  );
  assert.equal(
    shouldCorrectNodePlaygroundMeasuredSize(
      { width: 640, height: 420 },
      { width: 644, height: 420 }
    ),
    true
  );
});
