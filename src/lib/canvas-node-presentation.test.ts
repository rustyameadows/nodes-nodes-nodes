import assert from "node:assert/strict";
import test from "node:test";
import {
  canResizeWorkflowNode,
  doesWorkflowNodeLockAspectRatio,
  getCanvasNodeInteractionPolicy,
  resolveCanvasNodeFrameSize,
  resolveCanvasNodePresentation,
  shouldCanvasNodeMeasureContentHeight,
} from "./canvas-node-presentation";

test("promotes an explicitly opened model node into transient full mode without changing persisted display mode", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: "node-1",
    fullNodeId: "node-1",
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "preview");
  assert.equal(presentation.renderMode, "full");
  assert.equal(presentation.canResize, true);
  assert.equal(presentation.showResizeHandle, true);
  assert.equal(presentation.interactionPolicy, "model");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showTitleRail, true);
  assert.deepEqual(presentation.size, { width: 980, height: 385 });
});

test("keeps explicitly opened model nodes full even after selection moves away", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: "other-node",
    fullNodeId: "node-1",
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "preview");
  assert.equal(presentation.renderMode, "full");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showResizeHandle, false);
  assert.equal(presentation.showTitleRail, false);
  assert.equal(presentation.showActionRail, false);
});

test("keeps persisted full model nodes full even when another node is selected", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "full",
      size: null,
    },
    activeNodeId: "other-node",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "full");
  assert.equal(presentation.renderMode, "full");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showResizeHandle, false);
  assert.equal(presentation.showTitleRail, false);
  assert.equal(presentation.showActionRail, false);
  assert.deepEqual(presentation.size, { width: 980, height: 385 });
});

test("keeps selected preview model nodes at preview size until full mode is explicitly opened", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "text",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "preview");
  assert.equal(presentation.renderMode, "preview");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showResizeHandle, true);
  assert.equal(presentation.showTitleRail, true);
  assert.equal(presentation.showActionRail, true);
  assert.deepEqual(presentation.size, { width: 236, height: 84 });
});

test("keeps selected compact model nodes compact until full mode is explicitly opened", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "text",
      displayMode: "compact",
      size: null,
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "compact");
  assert.equal(presentation.renderMode, "compact");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showResizeHandle, false);
  assert.equal(presentation.showTitleRail, true);
  assert.equal(presentation.showActionRail, true);
  assert.deepEqual(presentation.size, { width: 168, height: 48 });
});

test("keeps compact nodes compact when full mode is not active", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "text-note",
      outputType: "text",
      displayMode: "compact",
      size: null,
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "compact");
  assert.equal(presentation.renderMode, "compact");
  assert.equal(presentation.showTitleRail, true);
  assert.deepEqual(presentation.size, { width: 148, height: 42 });
});

test("keeps templates in preview on single selection and only enters full mode when editing", () => {
  const selectedPreview = resolveCanvasNodePresentation({
    node: {
      kind: "text-template",
      outputType: "text",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: "template-1",
    fullNodeId: null,
    nodeId: "template-1",
  });

  assert.equal(selectedPreview.renderMode, "preview");
  assert.equal(selectedPreview.isExpanded, true);
  assert.equal(selectedPreview.isEditing, false);

  const editingPresentation = resolveCanvasNodePresentation({
    node: {
      kind: "text-template",
      outputType: "text",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: "template-1",
    fullNodeId: "template-1",
    nodeId: "template-1",
  });

  assert.equal(editingPresentation.renderMode, "full");
  assert.equal(editingPresentation.isEditing, true);
});

test("allows a library-only forced full render mode without exposing active rails", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "list",
      outputType: "text",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: null,
    fullNodeId: null,
    nodeId: "node-1",
    forcedRenderMode: "full",
  });

  assert.equal(presentation.persistedMode, "preview");
  assert.equal(presentation.renderMode, "full");
  assert.equal(presentation.showTitleRail, false);
  assert.equal(presentation.showActionRail, false);
  assert.deepEqual(presentation.size, { width: 840, height: 500 });
});

test("clamps resized list nodes to their minimum inline spreadsheet size", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "list",
      outputType: "text",
      displayMode: "resized",
      size: {
        width: 120,
        height: 20,
      },
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.renderMode, "resized");
  assert.equal(presentation.canResize, true);
  assert.deepEqual(presentation.size, { width: 156, height: 46 });
});

test("keeps resized model nodes on their stored size while selected", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "resized",
      size: {
        width: 640,
        height: 360,
      },
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.persistedMode, "resized");
  assert.equal(presentation.renderMode, "resized");
  assert.deepEqual(presentation.size, { width: 640, height: 360 });
  assert.equal(presentation.showResizeHandle, true);
});

test("keeps resized model nodes resized even when their explicit full editor flag is set", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "resized",
      size: {
        width: 640,
        height: 360,
      },
    },
    activeNodeId: "node-1",
    fullNodeId: "node-1",
    nodeId: "node-1",
  });

  assert.equal(presentation.renderMode, "resized");
  assert.deepEqual(presentation.size, { width: 640, height: 360 });
});

test("keeps resized model nodes expanded even after they are no longer active", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "model",
      outputType: "image",
      displayMode: "resized",
      size: {
        width: 640,
        height: 360,
      },
    },
    activeNodeId: null,
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.renderMode, "resized");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showResizeHandle, false);
  assert.equal(presentation.showTitleRail, false);
  assert.equal(presentation.showActionRail, false);
});

test("model full shells measure their content height while resized shells do not", () => {
  assert.equal(
    shouldCanvasNodeMeasureContentHeight({
      kind: "model",
      renderMode: "full",
    }),
    true
  );
  assert.equal(
    shouldCanvasNodeMeasureContentHeight({
      kind: "model",
      renderMode: "resized",
    }),
    false
  );
});

test("resized model frame size stays authoritative even when measured content is taller", () => {
  assert.deepEqual(
    resolveCanvasNodeFrameSize({
      kind: "model",
      renderMode: "resized",
      resolvedSize: { width: 640, height: 360 },
      measuredSize: { width: 640, height: 520 },
      fallbackSize: { width: 212, height: 72 },
    }),
    { width: 640, height: 360 }
  );
});

test("full model frame size still uses measured content height when no resize draft is active", () => {
  assert.deepEqual(
    resolveCanvasNodeFrameSize({
      kind: "model",
      renderMode: "full",
      resolvedSize: { width: 980, height: 385 },
      measuredSize: { width: 980, height: 520 },
      fallbackSize: { width: 212, height: 72 },
    }),
    { width: 980, height: 520 }
  );
});

test("active resize drafts stay authoritative even before the resized mode commit lands", () => {
  assert.deepEqual(
    resolveCanvasNodeFrameSize({
      kind: "model",
      renderMode: "full",
      resolvedSize: { width: 980, height: 385 },
      measuredSize: { width: 980, height: 520 },
      resizeDraftSize: { width: 720, height: 400 },
      fallbackSize: { width: 212, height: 72 },
    }),
    { width: 720, height: 400 }
  );
});

test("treats image asset nodes as resizable but aspect-ratio locked", () => {
  assert.equal(canResizeWorkflowNode({ kind: "asset-source" }), true);
  assert.equal(doesWorkflowNodeLockAspectRatio({ kind: "asset-source", outputType: "image" }), true);
  assert.equal(doesWorkflowNodeLockAspectRatio({ kind: "asset-source", outputType: "video" }), false);
  assert.equal(getCanvasNodeInteractionPolicy({ kind: "asset-source", outputType: "image" }), "image-asset");
});

test("uses uploaded landscape image aspect ratio for default asset node sizing", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "asset-source",
      outputType: "image",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: null,
    fullNodeId: null,
    nodeId: "asset-landscape",
    aspectRatio: 16 / 9,
  });

  assert.deepEqual(presentation.size, {
    width: 260,
    height: 146,
  });
});

test("uses uploaded portrait image aspect ratio for default asset node sizing", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "asset-source",
      outputType: "image",
      displayMode: "preview",
      size: null,
    },
    activeNodeId: null,
    fullNodeId: null,
    nodeId: "asset-portrait",
    aspectRatio: 3 / 4,
  });

  assert.deepEqual(presentation.size, {
    width: 195,
    height: 260,
  });
});
