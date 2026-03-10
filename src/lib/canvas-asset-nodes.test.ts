import assert from "node:assert/strict";
import test from "node:test";
import { defaultCanvasDocument, type Asset, type CanvasDocument, type WorkflowNode } from "@/components/workspace/types";
import { buildCanvasViewportCenterPosition, insertImportedAssetsIntoCanvasDocument } from "@/lib/canvas-asset-nodes";

function createAsset(overrides: Partial<Asset>): Asset {
  return {
    id: "asset-1",
    type: "image",
    storageRef: "project/asset.png",
    mimeType: "image/png",
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
    tagNames: [],
    rating: null,
    flagged: false,
    job: null,
    ...overrides,
  };
}

function createModelNode(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "model-1",
    label: "Model",
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
    x: 220,
    y: 180,
    displayMode: "preview",
    size: null,
    ...overrides,
  };
}

test("buildCanvasViewportCenterPosition uses the saved viewport and supplied surface size", () => {
  const canvasDocument: CanvasDocument = {
    ...defaultCanvasDocument,
    canvasViewport: {
      x: 240,
      y: 120,
      zoom: 2,
    },
  };

  const position = buildCanvasViewportCenterPosition(canvasDocument, {
    viewportWidth: 1000,
    viewportHeight: 800,
  });

  assert.deepEqual(position, {
    x: 130,
    y: 140,
  });
});

test("insertImportedAssetsIntoCanvasDocument adds asset-source nodes and connects image models", () => {
  const canvasDocument: CanvasDocument = {
    ...defaultCanvasDocument,
    workflow: {
      nodes: [createModelNode({ id: "model-a" })],
    },
  };

  const assetA = createAsset({
    id: "asset-a",
    storageRef: "project/red-fox.png",
  });
  const assetB = createAsset({
    id: "asset-b",
    storageRef: "project/otter.png",
  });

  const result = insertImportedAssetsIntoCanvasDocument(canvasDocument, [assetA, assetB], {
    defaultProvider: {
      providerId: "openai",
      modelId: "gpt-image-1.5",
    },
    position: { x: 300, y: 220 },
    connectToModelNodeId: "model-a",
    assetLabels: ["Red Fox.png", "Otter.png"],
  });

  assert.equal(result.insertedNodeIds.length, 2);
  assert.equal(result.canvasDocument.workflow.nodes.length, 3);

  const [modelNode, firstAssetNode, secondAssetNode] = result.canvasDocument.workflow.nodes;
  assert.deepEqual(modelNode.upstreamNodeIds, result.insertedNodeIds);
  assert.deepEqual(modelNode.upstreamAssetIds, ["asset-a", "asset-b"]);
  assert.equal(firstAssetNode.label, "Red Fox.png");
  assert.equal(secondAssetNode.label, "Otter.png");
  assert.equal(firstAssetNode.x, 300);
  assert.equal(secondAssetNode.x, 334);
  assert.equal(secondAssetNode.y, 246);
});

test("insertImportedAssetsIntoCanvasDocument does not connect text models", () => {
  const canvasDocument: CanvasDocument = {
    ...defaultCanvasDocument,
    workflow: {
      nodes: [
        createModelNode({
          id: "model-text",
          modelId: "gpt-5-mini",
          nodeType: "text-gen",
          outputType: "text",
        }),
      ],
    },
  };

  const result = insertImportedAssetsIntoCanvasDocument(canvasDocument, [createAsset({ id: "asset-text" })], {
    defaultProvider: {
      providerId: "openai",
      modelId: "gpt-image-1.5",
    },
    connectToModelNodeId: "model-text",
  });

  const [modelNode] = result.canvasDocument.workflow.nodes;
  assert.deepEqual(modelNode.upstreamNodeIds, []);
  assert.deepEqual(modelNode.upstreamAssetIds, []);
});
