import type { CanvasConnectionSelection, CanvasDocument, WorkflowNode } from "@/components/workspace/types";

export type CanvasHistoryState<TConnection = CanvasConnectionSelection> = {
  canvasDoc: CanvasDocument;
  selectedNodeIds: string[];
  selectedConnection: TConnection | null;
};

export type CanvasHistoryPatch<TConnection = CanvasConnectionSelection> = {
  nodeIds: string[];
  beforeNodes: WorkflowNode[];
  afterNodes: WorkflowNode[];
  beforeOrder: string[];
  afterOrder: string[];
  beforeSelectedNodeIds: string[];
  afterSelectedNodeIds: string[];
  beforeSelectedConnection: TConnection | null;
  afterSelectedConnection: TConnection | null;
};

export type CanvasHistoryDirection = "undo" | "redo";

function cloneNode(node: WorkflowNode) {
  return JSON.parse(JSON.stringify(node)) as WorkflowNode;
}

function cloneNodeList(nodes: WorkflowNode[]) {
  return nodes.map((node) => cloneNode(node));
}

function areNodesEqual(left: WorkflowNode | undefined, right: WorkflowNode | undefined) {
  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function areConnectionsEqual<TConnection>(left: TConnection | null, right: TConnection | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

export function createCanvasHistoryPatch<TConnection = CanvasConnectionSelection>(
  beforeState: CanvasHistoryState<TConnection>,
  afterState: CanvasHistoryState<TConnection>
): CanvasHistoryPatch<TConnection> | null {
  const beforeOrder = beforeState.canvasDoc.workflow.nodes.map((node) => node.id);
  const afterOrder = afterState.canvasDoc.workflow.nodes.map((node) => node.id);
  const beforeNodesById = new Map(beforeState.canvasDoc.workflow.nodes.map((node) => [node.id, node]));
  const afterNodesById = new Map(afterState.canvasDoc.workflow.nodes.map((node) => [node.id, node]));
  const candidateIds = uniqueIds([...beforeOrder, ...afterOrder]);
  const changedIds = candidateIds.filter((nodeId) => !areNodesEqual(beforeNodesById.get(nodeId), afterNodesById.get(nodeId)));

  const selectionChanged =
    JSON.stringify(beforeState.selectedNodeIds) !== JSON.stringify(afterState.selectedNodeIds) ||
    !areConnectionsEqual(beforeState.selectedConnection, afterState.selectedConnection);

  const orderChanged = JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder);

  if (changedIds.length === 0 && !selectionChanged && !orderChanged) {
    return null;
  }

  return {
    nodeIds: changedIds,
    beforeNodes: cloneNodeList(changedIds.map((nodeId) => beforeNodesById.get(nodeId)).filter(Boolean) as WorkflowNode[]),
    afterNodes: cloneNodeList(changedIds.map((nodeId) => afterNodesById.get(nodeId)).filter(Boolean) as WorkflowNode[]),
    beforeOrder,
    afterOrder,
    beforeSelectedNodeIds: [...beforeState.selectedNodeIds],
    afterSelectedNodeIds: [...afterState.selectedNodeIds],
    beforeSelectedConnection:
      beforeState.selectedConnection === null
        ? null
        : (JSON.parse(JSON.stringify(beforeState.selectedConnection)) as TConnection),
    afterSelectedConnection:
      afterState.selectedConnection === null
        ? null
        : (JSON.parse(JSON.stringify(afterState.selectedConnection)) as TConnection),
  };
}

export function applyCanvasHistoryPatch<TConnection = CanvasConnectionSelection>(
  currentState: CanvasHistoryState<TConnection>,
  patch: CanvasHistoryPatch<TConnection>,
  direction: CanvasHistoryDirection
): CanvasHistoryState<TConnection> {
  const targetNodes = direction === "undo" ? patch.beforeNodes : patch.afterNodes;
  const targetOrder = direction === "undo" ? patch.beforeOrder : patch.afterOrder;
  const targetSelectedNodeIds = direction === "undo" ? patch.beforeSelectedNodeIds : patch.afterSelectedNodeIds;
  const targetSelectedConnection = direction === "undo" ? patch.beforeSelectedConnection : patch.afterSelectedConnection;
  const changedNodeIds = new Set(patch.nodeIds);
  const nextNodesById = new Map(currentState.canvasDoc.workflow.nodes.map((node) => [node.id, cloneNode(node)]));

  for (const nodeId of changedNodeIds) {
    nextNodesById.delete(nodeId);
  }

  for (const node of targetNodes) {
    nextNodesById.set(node.id, cloneNode(node));
  }

  const mentionedIds = new Set(targetOrder);
  const orderedNodes = targetOrder
    .map((nodeId) => nextNodesById.get(nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));
  const extraNodes = currentState.canvasDoc.workflow.nodes
    .map((node) => node.id)
    .filter((nodeId) => !mentionedIds.has(nodeId) && nextNodesById.has(nodeId))
    .map((nodeId) => nextNodesById.get(nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));

  const nextDoc: CanvasDocument = {
    ...currentState.canvasDoc,
    workflow: {
      nodes: [...orderedNodes, ...extraNodes],
    },
  };

  const existingNodeIds = new Set(nextDoc.workflow.nodes.map((node) => node.id));
  return {
    canvasDoc: nextDoc,
    selectedNodeIds: targetSelectedNodeIds.filter((nodeId) => existingNodeIds.has(nodeId)),
    selectedConnection:
      targetSelectedConnection &&
      typeof targetSelectedConnection === "object" &&
      "sourceNodeId" in targetSelectedConnection &&
      "targetNodeId" in targetSelectedConnection &&
      existingNodeIds.has(targetSelectedConnection.sourceNodeId as string) &&
      existingNodeIds.has(targetSelectedConnection.targetNodeId as string)
        ? targetSelectedConnection
        : null,
  };
}
