import type { CanvasDocument, WorkflowNode } from "@/components/workspace/types";
import { getGeneratedNodeDescriptorKey } from "@/lib/generated-text-output";
import { getGeneratedModelNodeSource } from "@/lib/list-template";

function getNodeSourceJobId(node: WorkflowNode) {
  if (node.sourceJobId) {
    return node.sourceJobId;
  }
  return typeof node.settings.sourceJobId === "string" ? node.settings.sourceJobId : null;
}

function getNodeSourceOutputIndex(node: WorkflowNode) {
  if (typeof node.sourceOutputIndex === "number") {
    return node.sourceOutputIndex;
  }
  return typeof node.settings.outputIndex === "number" ? Number(node.settings.outputIndex) : null;
}

export function getGeneratedOutputReceiptKey(input: {
  sourceJobId: string;
  outputIndex: number;
  descriptorIndex?: number;
}) {
  return getGeneratedNodeDescriptorKey({
    sourceJobId: input.sourceJobId,
    outputIndex: input.outputIndex,
    descriptorIndex: input.descriptorIndex ?? 0,
  });
}

export function getGeneratedOutputReceiptKeyForNode(node: WorkflowNode): string | null {
  const generatedModelSource = getGeneratedModelNodeSource(node.settings);
  if (generatedModelSource) {
    return getGeneratedOutputReceiptKey({
      sourceJobId: generatedModelSource.sourceJobId,
      outputIndex: generatedModelSource.outputIndex,
      descriptorIndex: generatedModelSource.descriptorIndex,
    });
  }

  if (node.kind !== "asset-source") {
    return null;
  }

  const sourceJobId = getNodeSourceJobId(node);
  const outputIndex = getNodeSourceOutputIndex(node);
  const sourceType = typeof node.settings.source === "string" ? node.settings.source : null;

  if (!sourceJobId || typeof outputIndex !== "number" || sourceType !== "generated") {
    return null;
  }

  return getGeneratedOutputReceiptKey({
    sourceJobId,
    outputIndex,
    descriptorIndex: 0,
  });
}

export function getLegacyGeneratedOutputReceiptKeys(nodes: WorkflowNode[]) {
  return [...new Set(nodes.map((node) => getGeneratedOutputReceiptKeyForNode(node)).filter(Boolean) as string[])].sort();
}

export function getCanvasGeneratedOutputReceiptKeys(canvasDoc: CanvasDocument) {
  return new Set(canvasDoc.generatedOutputReceiptKeys || []);
}

export function setCanvasGeneratedOutputReceiptKeys(canvasDoc: CanvasDocument, receiptKeys: Iterable<string>): CanvasDocument {
  return {
    ...canvasDoc,
    generatedOutputReceiptKeys: [...new Set(receiptKeys)].sort(),
  };
}
