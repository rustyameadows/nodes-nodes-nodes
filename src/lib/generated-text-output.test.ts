import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGeneratedDescriptorToNode,
  createFallbackGeneratedTextNoteDescriptor,
  createGeneratedModelNode,
  getStructuredTextOutputContract,
  parseStructuredTextOutput,
  type GeneratedNodeDescriptor,
} from "@/lib/generated-text-output";
import type { WorkflowNode } from "@/components/workspace/types";

function createModelNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "model-1",
    label: "Model 1",
    providerId: "openai",
    modelId: "gpt-5.4",
    kind: "model",
    nodeType: "text-gen",
    outputType: "text",
    prompt: "",
    settings: { textOutputTarget: "smart" },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: 120,
    y: 180,
    ...overrides,
  };
}

test("parses list output into a generated list descriptor", () => {
  const parsed = parseStructuredTextOutput({
    textOutputTarget: "list",
    content: JSON.stringify({
      kind: "list",
      label: "Southwest Cities",
      columns: ["City", "State"],
      rows: [
        ["Phoenix", "Arizona"],
        ["Santa Fe", "New Mexico"],
      ],
    }),
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
  });

  assert.equal(parsed.warning, null);
  assert.equal(parsed.generatedNodeDescriptors.length, 1);
  assert.deepEqual(parsed.generatedNodeDescriptors[0], {
    kind: "list",
    label: "Southwest Cities",
    columns: ["City", "State"],
    rows: [
      ["Phoenix", "Arizona"],
      ["Santa Fe", "New Mexico"],
    ],
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    outputIndex: 0,
    descriptorIndex: 0,
  });
});

test("parses smart output into multiple detached descriptor candidates", () => {
  const parsed = parseStructuredTextOutput({
    textOutputTarget: "smart",
    content: JSON.stringify({
      nodes: [
        {
          kind: "text-note",
          label: "Brief",
          text: "Ten southwest cities.",
        },
        {
          kind: "list",
          label: "Cities",
          columns: ["City"],
          rows: [["Phoenix"], ["Tucson"]],
        },
        {
          kind: "text-template",
          label: "Prompt Template",
          templateText: "Illustrate [city] at sunset.",
        },
      ],
    }),
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
  });

  assert.equal(parsed.warning, null);
  assert.equal(parsed.generatedNodeDescriptors.length, 3);
  assert.deepEqual(
    parsed.generatedNodeDescriptors.map((descriptor) => descriptor.kind),
    ["text-note", "list", "text-template"]
  );
  assert.deepEqual(
    parsed.generatedNodeDescriptors.map((descriptor) => descriptor.descriptorIndex),
    [0, 1, 2]
  );
  assert.deepEqual(
    parsed.generatedNodeDescriptors[1] && "columns" in parsed.generatedNodeDescriptors[1]
      ? parsed.generatedNodeDescriptors[1].columns
      : null,
    ["City"]
  );
  assert.equal(
    parsed.generatedNodeDescriptors[2] && "templateText" in parsed.generatedNodeDescriptors[2]
      ? parsed.generatedNodeDescriptors[2].templateText
      : null,
    "Illustrate [[city]] at sunset."
  );
});

test("allows smart output templates to repeat placeholders in any order", () => {
  const parsed = parseStructuredTextOutput({
    textOutputTarget: "smart",
    content: JSON.stringify({
      nodes: [
        {
          kind: "list",
          label: "Animals",
          columns: ["Species", "Pose"],
          rows: [["Otter", "sleeping"]],
        },
        {
          kind: "text-template",
          label: "Prompt Template",
          templateText: "Show [Pose] behavior for a [Species]. Then show the [Species] again.",
        },
      ],
    }),
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
  });

  assert.equal(parsed.warning, null);
  assert.equal(parsed.generatedNodeDescriptors.length, 2);
  assert.equal(
    parsed.generatedNodeDescriptors[1] && "templateText" in parsed.generatedNodeDescriptors[1]
      ? parsed.generatedNodeDescriptors[1].templateText
      : null,
    "Show [[Pose]] behavior for a [[Species]]. Then show the [[Species]] again."
  );
});

test("builds smart-output instructions from the node catalog summaries", () => {
  const contract = getStructuredTextOutputContract("smart");

  assert.match(contract.instructions, /Allowed kinds are text-note, list, text-template\./);
  assert.match(contract.instructions, /text-note: Use for plain written content/i);
  assert.match(contract.instructions, /list: Use for structured repeated data/i);
  assert.match(contract.instructions, /text-template: Use for reusable prompt or writing patterns/i);
});

test("falls back to a generated text note when structured parsing fails", () => {
  const parsed = parseStructuredTextOutput({
    textOutputTarget: "template",
    content: "{\"kind\":\"list\"}",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
  });

  assert.equal(parsed.generatedNodeDescriptors.length, 1);
  assert.equal(parsed.generatedNodeDescriptors[0]?.kind, "text-note");
  assert.match(parsed.warning || "", /Structured output parsing failed/);
});

test("materializes smart output list nodes without upstream connections", () => {
  const modelNode = createModelNode();
  const descriptor: GeneratedNodeDescriptor = {
    kind: "list",
    label: "Cities",
    columns: ["City"],
    rows: [["Phoenix"], ["Tucson"]],
    sourceJobId: "job-1",
    sourceModelNodeId: modelNode.id,
    outputIndex: 0,
    descriptorIndex: 1,
  };

  const node = createGeneratedModelNode({
    id: "generated-list-1",
    providerId: modelNode.providerId,
    modelId: modelNode.modelId,
    modelNodeId: modelNode.id,
    label: descriptor.label,
    position: { x: 300, y: 220 },
    processingState: null,
    descriptor,
    connectToSourceModel: false,
  });

  assert.equal(node.kind, "list");
  assert.deepEqual(node.upstreamNodeIds, []);
  assert.equal(node.sourceJobId, "job-1");
  assert.equal(node.sourceOutputIndex, 0);
  assert.equal(node.settings.descriptorIndex, 1);
  assert.equal(node.settings.columns[0]?.label, "City");
});

test("preserves edited content after a generated node is hydrated once", () => {
  const descriptor = createFallbackGeneratedTextNoteDescriptor({
    content: "Original model output",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    descriptorIndex: 0,
  });

  const pendingNode = createGeneratedModelNode({
    id: "generated-note-1",
    providerId: "openai",
    modelId: "gpt-5.4",
    modelNodeId: "model-1",
    label: descriptor.label,
    position: { x: 300, y: 220 },
    processingState: "running",
    descriptor,
  });

  const completedNode = applyGeneratedDescriptorToNode(pendingNode, {
    providerId: "openai",
    modelId: "gpt-5.4",
    processingState: null,
    descriptor,
    allowContentHydration: true,
  });
  assert.equal(completedNode.prompt, "Original model output");

  const editedNode = {
    ...completedNode,
    prompt: "Edited by user",
  };

  const rereadNode = applyGeneratedDescriptorToNode(editedNode, {
    providerId: "openai",
    modelId: "gpt-5.4",
    processingState: null,
    descriptor,
    allowContentHydration: false,
  });

  assert.equal(rereadNode.prompt, "Edited by user");
});

test("preserves user graph connections when a generated node rehydrates", () => {
  const descriptor: GeneratedNodeDescriptor = {
    kind: "text-template",
    label: "Prompt Template",
    templateText: "Draw [[Animal]].",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    outputIndex: 0,
    descriptorIndex: 1,
  };

  const connectedNode = createGeneratedModelNode({
    id: "generated-template-1",
    providerId: "openai",
    modelId: "gpt-5.4",
    modelNodeId: "model-1",
    label: descriptor.label,
    position: { x: 300, y: 220 },
    processingState: null,
    descriptor,
    connectToSourceModel: false,
  });

  const userConnectedNode = {
    ...connectedNode,
    upstreamNodeIds: ["list-1"],
    upstreamAssetIds: ["node:list-1"],
  };

  const rehydratedNode = applyGeneratedDescriptorToNode(userConnectedNode, {
    providerId: "openai",
    modelId: "gpt-5.4",
    processingState: null,
    descriptor,
    allowContentHydration: false,
    connectToSourceModel: false,
  });

  assert.deepEqual(rehydratedNode.upstreamNodeIds, ["list-1"]);
  assert.deepEqual(rehydratedNode.upstreamAssetIds, ["node:list-1"]);
});
