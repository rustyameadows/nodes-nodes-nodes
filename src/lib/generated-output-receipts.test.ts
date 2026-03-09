import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasGeneratedOutputReceiptKeys,
  getGeneratedOutputReceiptKey,
  getGeneratedOutputReceiptKeyForNode,
  getLegacyGeneratedOutputReceiptKeys,
  setCanvasGeneratedOutputReceiptKeys,
} from "@/lib/generated-output-receipts";
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
    displayMode: "preview",
    size: null,
    ...patch,
  };
}

test("reads receipt keys from generated text, list, template, and asset nodes", () => {
  const textNode = createNode("text", {
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    settings: {
      source: "generated-model-text",
      sourceJobId: "job-text",
      sourceModelNodeId: "model-a",
      outputIndex: 0,
      descriptorIndex: 0,
    },
  });
  const listNode = createNode("list", {
    kind: "list",
    nodeType: "list",
    outputType: "text",
    settings: {
      source: "generated-model-list",
      sourceJobId: "job-list",
      sourceModelNodeId: "model-a",
      outputIndex: 0,
      descriptorIndex: 2,
      columns: [],
      rows: [],
    },
  });
  const templateNode = createNode("template", {
    kind: "text-template",
    nodeType: "text-template",
    outputType: "text",
    settings: {
      source: "generated-model-template",
      sourceJobId: "job-template",
      sourceModelNodeId: "model-a",
      outputIndex: 0,
      descriptorIndex: 1,
    },
  });
  const assetNode = createNode("asset", {
    kind: "asset-source",
    nodeType: "transform",
    outputType: "image",
    sourceJobId: "job-image",
    sourceOutputIndex: 3,
    settings: {
      source: "generated",
      sourceJobId: "job-image",
      sourceModelNodeId: "model-a",
      outputIndex: 3,
    },
  });

  assert.equal(getGeneratedOutputReceiptKeyForNode(textNode), "job-text:0:0");
  assert.equal(getGeneratedOutputReceiptKeyForNode(listNode), "job-list:0:2");
  assert.equal(getGeneratedOutputReceiptKeyForNode(templateNode), "job-template:0:1");
  assert.equal(getGeneratedOutputReceiptKeyForNode(assetNode), "job-image:3:0");
});

test("builds legacy receipt keys from existing generated nodes", () => {
  const nodes = [
    createNode("a", {
      kind: "text-note",
      nodeType: "text-note",
      outputType: "text",
      settings: {
        source: "generated-model-text",
        sourceJobId: "job-1",
        sourceModelNodeId: "model-a",
        outputIndex: 0,
        descriptorIndex: 0,
      },
    }),
    createNode("b", {
      kind: "asset-source",
      nodeType: "transform",
      outputType: "image",
      sourceJobId: "job-2",
      sourceOutputIndex: 1,
      settings: {
        source: "generated",
        sourceJobId: "job-2",
        sourceModelNodeId: "model-b",
        outputIndex: 1,
      },
    }),
    createNode("c"),
  ];

  assert.deepEqual(getLegacyGeneratedOutputReceiptKeys(nodes), ["job-1:0:0", "job-2:1:0"]);
});

test("stores receipt keys on the canvas document", () => {
  const canvasDoc: CanvasDocument = {
    canvasViewport: {
      x: 100,
      y: 200,
      zoom: 1,
    },
    workflow: {
      nodes: [],
    },
  };

  const nextDoc = setCanvasGeneratedOutputReceiptKeys(canvasDoc, [
    getGeneratedOutputReceiptKey({ sourceJobId: "job-2", outputIndex: 0 }),
    getGeneratedOutputReceiptKey({ sourceJobId: "job-1", outputIndex: 2, descriptorIndex: 1 }),
    getGeneratedOutputReceiptKey({ sourceJobId: "job-2", outputIndex: 0 }),
  ]);

  assert.deepEqual(nextDoc.generatedOutputReceiptKeys, ["job-1:2:1", "job-2:0:0"]);
  assert.deepEqual([...getCanvasGeneratedOutputReceiptKeys(nextDoc)], ["job-1:2:1", "job-2:0:0"]);
});
