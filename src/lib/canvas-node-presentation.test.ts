import assert from "node:assert/strict";
import test from "node:test";
import {
  canResizeWorkflowNode,
  doesWorkflowNodeLockAspectRatio,
  getCanvasNodeInteractionPolicy,
  resolveCanvasNodePresentation,
} from "./canvas-node-presentation";

test("promotes the active full node into transient full mode without changing persisted display mode", () => {
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
  assert.equal(presentation.interactionPolicy, "model");
  assert.equal(presentation.isExpanded, true);
  assert.equal(presentation.showTitleRail, true);
  assert.deepEqual(presentation.size, { width: 980, height: 420 });
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

test("clamps resized list nodes to their minimum inline spreadsheet size", () => {
  const presentation = resolveCanvasNodePresentation({
    node: {
      kind: "list",
      outputType: "text",
      displayMode: "resized",
      size: {
        width: 120,
        height: 80,
      },
    },
    activeNodeId: "node-1",
    fullNodeId: null,
    nodeId: "node-1",
  });

  assert.equal(presentation.renderMode, "resized");
  assert.equal(presentation.canResize, true);
  assert.deepEqual(presentation.size, { width: 520, height: 320 });
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
