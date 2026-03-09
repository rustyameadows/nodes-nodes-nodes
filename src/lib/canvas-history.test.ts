import assert from "node:assert/strict";
import test from "node:test";
import { applyCanvasHistoryPatch, createCanvasHistoryPatch, type CanvasHistoryState } from "@/lib/canvas-history";
import type { CanvasDocument, WorkflowNode } from "@/components/workspace/types";

function createNode(id: string, patch?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    label: id,
    providerId: "openai",
    modelId: "gpt-image-1.5",
    kind: "model",
    nodeType: "image-gen",
    outputType: "image",
    prompt: "",
    settings: {},
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: 10,
    y: 20,
    ...patch,
  };
}

function createState(
  nodes: WorkflowNode[],
  selection: string[] = [],
  selectedConnection: { sourceNodeId: string; targetNodeId: string } | null = null
): CanvasHistoryState<{ sourceNodeId: string; targetNodeId: string }> {
  const canvasDoc: CanvasDocument = {
    canvasViewport: {
      x: 100,
      y: 200,
      zoom: 1.5,
    },
    workflow: {
      nodes,
    },
  };

  return {
    canvasDoc,
    selectedNodeIds: selection,
    selectedConnection,
  };
}

test("builds and applies history patches without changing the viewport", () => {
  const before = createState([createNode("a", { x: 10 }), createNode("b", { x: 60 })], ["a"]);
  const after = createState([createNode("a", { x: 110 }), createNode("b", { x: 160 })], ["a", "b"]);
  const patch = createCanvasHistoryPatch(before, after);

  assert.ok(patch);
  const undone = applyCanvasHistoryPatch(after, patch, "undo");
  assert.deepEqual(
    undone.canvasDoc.workflow.nodes.map((node) => ({ id: node.id, x: node.x })),
    before.canvasDoc.workflow.nodes.map((node) => ({ id: node.id, x: node.x }))
  );
  assert.deepEqual(undone.selectedNodeIds, ["a"]);
  assert.deepEqual(undone.canvasDoc.canvasViewport, after.canvasDoc.canvasViewport);

  const redone = applyCanvasHistoryPatch(before, patch, "redo");
  assert.deepEqual(
    redone.canvasDoc.workflow.nodes.map((node) => ({ id: node.id, x: node.x })),
    after.canvasDoc.workflow.nodes.map((node) => ({ id: node.id, x: node.x }))
  );
  assert.deepEqual(redone.selectedNodeIds, ["a", "b"]);
  assert.deepEqual(redone.canvasDoc.canvasViewport, before.canvasDoc.canvasViewport);
});

test("preserves unrelated nodes added outside the recorded patch", () => {
  const before = createState([createNode("a")], ["a"]);
  const after = createState([createNode("a", { x: 50 })], ["a"]);
  const patch = createCanvasHistoryPatch(before, after);

  assert.ok(patch);

  const currentWithAsyncNode = createState([createNode("a", { x: 50 }), createNode("async", { y: 300 })], ["a"]);
  const undone = applyCanvasHistoryPatch(currentWithAsyncNode, patch, "undo");

  assert.deepEqual(undone.canvasDoc.workflow.nodes.map((node) => node.id), ["a", "async"]);
  assert.equal(undone.canvasDoc.workflow.nodes.find((node) => node.id === "a")?.x, 10);
  assert.equal(undone.canvasDoc.workflow.nodes.find((node) => node.id === "async")?.y, 300);
});

test("returns null for no-op history entries", () => {
  const state = createState([createNode("a")], ["a"]);
  assert.equal(createCanvasHistoryPatch(state, state), null);
});
