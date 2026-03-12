import type { CanvasAccentType, CanvasRenderNode } from "@/components/canvas-node-types";
import type { CanvasConnectionSelection, WorkflowNode } from "@/components/workspace/types";

type CanvasConnectionNodeLike = Pick<
  WorkflowNode,
  "id" | "kind" | "outputType" | "promptSourceNodeId" | "upstreamNodeIds"
> &
  Partial<Pick<WorkflowNode, "processingState">> &
  Partial<Pick<CanvasRenderNode, "assetOrigin" | "outputSemanticType">>;

function getNodeOutputSemanticType(node: CanvasConnectionNodeLike): CanvasAccentType {
  return node.outputSemanticType || node.outputType;
}

function isGeneratedAssetNode(node: CanvasConnectionNodeLike) {
  return node.kind === "asset-source" && node.assetOrigin === "generated";
}

export function buildCanvasConnections(nodes: CanvasConnectionNodeLike[]): CanvasConnectionSelection[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return nodes.flatMap((targetNode) => {
    const connections: CanvasConnectionSelection[] = [
      ...targetNode.upstreamNodeIds.map((sourceNodeId) => ({
        id: `input:${sourceNodeId}->${targetNode.id}`,
        kind: "input" as const,
        sourceNodeId,
        targetNodeId: targetNode.id,
        semanticType: "image" as const,
        lineStyle: "solid" as const,
      })),
      ...(targetNode.promptSourceNodeId
        ? [
            {
              id: `prompt:${targetNode.promptSourceNodeId}->${targetNode.id}`,
              kind: "prompt" as const,
              sourceNodeId: targetNode.promptSourceNodeId,
              targetNodeId: targetNode.id,
              semanticType: "text" as const,
              lineStyle: "solid" as const,
            },
          ]
        : []),
    ];

    return connections
      .map((connection) => {
        const sourceNode = nodesById.get(connection.sourceNodeId);
        if (!sourceNode) {
          return null;
        }

        return {
          ...connection,
          semanticType:
            connection.kind === "prompt"
              ? ("text" as const)
              : sourceNode.kind === "model" && isGeneratedAssetNode(targetNode)
                ? ("citrus" as const)
                : getNodeOutputSemanticType(sourceNode),
          lineStyle:
            connection.kind === "input" &&
            isGeneratedAssetNode(targetNode) &&
            (targetNode.processingState === "queued" || targetNode.processingState === "running")
              ? ("dashed" as const)
              : ("solid" as const),
        };
      })
      .filter((connection): connection is CanvasConnectionSelection => Boolean(connection));
  });
}

export function buildCanvasSelectionConnections(
  nodes: CanvasConnectionNodeLike[],
  selectedNodeIds: string[]
) {
  const selectedNodeIdSet = new Set(selectedNodeIds);
  return buildCanvasConnections(nodes).filter((connection) => {
    return selectedNodeIdSet.has(connection.sourceNodeId) && selectedNodeIdSet.has(connection.targetNodeId);
  });
}
