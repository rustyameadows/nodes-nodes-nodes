import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowNode } from "@/components/workspace/types";
import { canConnectCanvasNodes } from "@/lib/canvas-connection-rules";
import { createGeneratedModelTextNoteSettings, createGeneratedTextNoteSettings } from "@/lib/list-template";

function createNode(overrides: Partial<WorkflowNode> & Pick<WorkflowNode, "id" | "kind" | "nodeType" | "outputType">): WorkflowNode {
  return {
    id: overrides.id,
    label: overrides.label || overrides.id,
    kind: overrides.kind,
    providerId: overrides.providerId || "openai",
    modelId: overrides.modelId || "gpt-image-1.5",
    nodeType: overrides.nodeType,
    outputType: overrides.outputType,
    prompt: overrides.prompt || "",
    settings: overrides.settings || {},
    sourceAssetId: overrides.sourceAssetId || null,
    sourceAssetMimeType: overrides.sourceAssetMimeType || null,
    sourceJobId: overrides.sourceJobId || null,
    sourceOutputIndex: overrides.sourceOutputIndex ?? null,
    processingState: overrides.processingState || null,
    promptSourceNodeId: overrides.promptSourceNodeId || null,
    upstreamNodeIds: overrides.upstreamNodeIds || [],
    upstreamAssetIds: overrides.upstreamAssetIds || [],
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
  };
}

test("allows selected text note to connect into a model prompt input", () => {
  const note = createNode({
    id: "note-1",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    settings: { source: "text-note" },
  });
  const model = createNode({
    id: "model-1",
    kind: "model",
    nodeType: "image-gen",
    outputType: "image",
  });

  assert.equal(canConnectCanvasNodes(note, model), true);
  assert.equal(canConnectCanvasNodes(model, note), false);
});

test("allows list to connect into a text template and rejects other template targets", () => {
  const list = createNode({
    id: "list-1",
    kind: "list",
    nodeType: "list",
    outputType: "text",
  });
  const template = createNode({
    id: "template-1",
    kind: "text-template",
    nodeType: "text-template",
    outputType: "text",
  });
  const model = createNode({
    id: "model-1",
    kind: "model",
    nodeType: "image-gen",
    outputType: "image",
  });

  assert.equal(canConnectCanvasNodes(list, template), true);
  assert.equal(canConnectCanvasNodes(list, model), false);
  assert.equal(canConnectCanvasNodes(template, model), false);
});

test("rejects image-input connections into text-only models", () => {
  const asset = createNode({
    id: "asset-1",
    kind: "asset-source",
    nodeType: "transform",
    outputType: "image",
  });
  const textModel = createNode({
    id: "text-model",
    kind: "model",
    nodeType: "text-gen",
    outputType: "text",
    modelId: "gpt-5-mini",
  });

  assert.equal(canConnectCanvasNodes(asset, textModel), false);
});

test("allows model/template connections into generated text notes only", () => {
  const model = createNode({
    id: "model-1",
    kind: "model",
    nodeType: "image-gen",
    outputType: "image",
  });
  const template = createNode({
    id: "template-1",
    kind: "text-template",
    nodeType: "text-template",
    outputType: "text",
  });
  const generatedFromModel = createNode({
    id: "generated-note-1",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    settings: createGeneratedModelTextNoteSettings({
      sourceJobId: "job-1",
      sourceModelNodeId: model.id,
      outputIndex: 0,
    }),
  });
  const generatedFromTemplate = createNode({
    id: "generated-note-2",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    settings: createGeneratedTextNoteSettings({
      sourceTemplateNodeId: template.id,
      sourceListNodeId: "list-1",
      batchId: "batch-1",
      rowId: "row-1",
      rowIndex: 0,
    }),
  });
  const regularNote = createNode({
    id: "note-plain",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    settings: { source: "text-note" },
  });

  assert.equal(canConnectCanvasNodes(model, generatedFromModel), true);
  assert.equal(canConnectCanvasNodes(template, generatedFromTemplate), true);
  assert.equal(canConnectCanvasNodes(model, regularNote), false);
});
