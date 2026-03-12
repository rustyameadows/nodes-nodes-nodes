export type CanvasGraphLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
};

export type CanvasGraphLayoutEdge = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type CanvasGraphLayoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasGraphLayoutComponent = {
  nodeIds: string[];
  bounds: CanvasGraphLayoutBounds;
  hasCycle: boolean;
};

export type CanvasGraphLayoutResult = {
  positions: Record<string, { x: number; y: number }>;
  bounds: CanvasGraphLayoutBounds;
  components: CanvasGraphLayoutComponent[];
  hasCycle: boolean;
};

type CanvasGraphLayoutOptions = {
  anchor?: { x: number; y: number };
  columnGap?: number;
  rowGap?: number;
  componentGap?: number;
};

type LocalNodePlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_COLUMN_GAP = 120;
const DEFAULT_ROW_GAP = 56;
const DEFAULT_COMPONENT_GAP = 112;

function createEmptyBounds(anchor = { x: 0, y: 0 }): CanvasGraphLayoutBounds {
  return {
    x: anchor.x,
    y: anchor.y,
    width: 0,
    height: 0,
  };
}

function compareNodes(left: CanvasGraphLayoutNode, right: CanvasGraphLayoutNode) {
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  return left.order - right.order;
}

function compareNodeIds(
  leftId: string,
  rightId: string,
  nodesById: Map<string, CanvasGraphLayoutNode>
) {
  const left = nodesById.get(leftId);
  const right = nodesById.get(rightId);
  if (!left || !right) {
    return leftId.localeCompare(rightId);
  }
  return compareNodes(left, right);
}

function buildBoundsFromPlacements(
  placements: LocalNodePlacement[],
  anchor = { x: 0, y: 0 }
): CanvasGraphLayoutBounds {
  if (placements.length === 0) {
    return createEmptyBounds(anchor);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const placement of placements) {
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function getCanvasGraphBounds(
  nodes: Array<Pick<CanvasGraphLayoutNode, "x" | "y" | "width" | "height">>,
  anchor = { x: 0, y: 0 }
): CanvasGraphLayoutBounds {
  if (nodes.length === 0) {
    return createEmptyBounds(anchor);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function buildConnectedComponents(
  nodes: CanvasGraphLayoutNode[],
  edges: CanvasGraphLayoutEdge[]
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      continue;
    }
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }

  const visited = new Set<string>();
  const components: CanvasGraphLayoutNode[][] = [];

  for (const node of [...nodes].sort(compareNodes)) {
    if (visited.has(node.id)) {
      continue;
    }

    const component: CanvasGraphLayoutNode[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const componentNode = nodesById.get(nodeId);
      if (!componentNode) {
        continue;
      }
      component.push(componentNode);

      for (const neighborId of adjacency.get(nodeId) || []) {
        if (visited.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }

    component.sort(compareNodes);
    components.push(component);
  }

  return components.sort((left, right) => {
    const leftFirst = left[0];
    const rightFirst = right[0];
    if (!leftFirst || !rightFirst) {
      return left.length - right.length;
    }
    return compareNodes(leftFirst, rightFirst);
  });
}

function layoutComponent(
  componentNodes: CanvasGraphLayoutNode[],
  allEdges: CanvasGraphLayoutEdge[],
  options: Required<Pick<CanvasGraphLayoutOptions, "columnGap" | "rowGap">>
) {
  const nodesById = new Map(componentNodes.map((node) => [node.id, node]));
  const edges = allEdges.filter((edge) => nodesById.has(edge.sourceNodeId) && nodesById.has(edge.targetNodeId));
  const predecessors = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const componentNodeIds = componentNodes.map((node) => node.id);
  const rankById = new Map<string, number>();

  for (const node of componentNodes) {
    predecessors.set(node.id, []);
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
    rankById.set(node.id, 0);
  }

  for (const edge of edges) {
    predecessors.get(edge.targetNodeId)?.push(edge.sourceNodeId);
    outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) || 0) + 1);
  }

  const queue = componentNodeIds
    .filter((nodeId) => (indegree.get(nodeId) || 0) === 0)
    .sort((leftId, rightId) => compareNodeIds(leftId, rightId, nodesById));
  const orderedNodeIds: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    orderedNodeIds.push(nodeId);

    for (const nextNodeId of outgoing.get(nodeId) || []) {
      const nextRank = Math.max(rankById.get(nextNodeId) || 0, (rankById.get(nodeId) || 0) + 1);
      rankById.set(nextNodeId, nextRank);
      indegree.set(nextNodeId, (indegree.get(nextNodeId) || 0) - 1);

      if ((indegree.get(nextNodeId) || 0) !== 0) {
        continue;
      }

      queue.push(nextNodeId);
      queue.sort((leftId, rightId) => compareNodeIds(leftId, rightId, nodesById));
    }
  }

  let hasCycle = false;
  if (orderedNodeIds.length !== componentNodes.length) {
    hasCycle = true;
    const stableNodeIds = [...componentNodes].sort(compareNodes).map((node) => node.id);
    for (const [index, nodeId] of stableNodeIds.entries()) {
      rankById.set(nodeId, index);
    }
    orderedNodeIds.splice(0, orderedNodeIds.length, ...stableNodeIds);
  }

  const nodesByRank = new Map<number, CanvasGraphLayoutNode[]>();
  for (const nodeId of orderedNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      continue;
    }
    const rank = rankById.get(nodeId) || 0;
    const rankNodes = nodesByRank.get(rank) || [];
    rankNodes.push(node);
    nodesByRank.set(rank, rankNodes);
  }

  const sortedRanks = [...nodesByRank.keys()].sort((left, right) => left - right);
  for (const rank of sortedRanks) {
    nodesByRank.get(rank)?.sort(compareNodes);
  }

  let nextX = 0;
  const placements: LocalNodePlacement[] = [];

  for (const rank of sortedRanks) {
    const rankNodes = nodesByRank.get(rank) || [];
    const columnWidth = rankNodes.reduce((maxWidth, node) => Math.max(maxWidth, node.width), 0);
    let nextY = 0;

    for (const node of rankNodes) {
      placements.push({
        id: node.id,
        x: nextX,
        y: nextY,
        width: node.width,
        height: node.height,
      });
      nextY += node.height + options.rowGap;
    }

    nextX += columnWidth + options.columnGap;
  }

  const bounds = buildBoundsFromPlacements(placements);

  return {
    placements,
    bounds,
    nodeIds: orderedNodeIds,
    hasCycle,
  };
}

export function layoutCanvasGraph(
  nodes: CanvasGraphLayoutNode[],
  edges: CanvasGraphLayoutEdge[],
  options?: CanvasGraphLayoutOptions
): CanvasGraphLayoutResult {
  if (nodes.length === 0) {
    return {
      positions: {},
      bounds: createEmptyBounds(options?.anchor),
      components: [],
      hasCycle: false,
    };
  }

  const anchor = options?.anchor || { x: 0, y: 0 };
  const columnGap = options?.columnGap ?? DEFAULT_COLUMN_GAP;
  const rowGap = options?.rowGap ?? DEFAULT_ROW_GAP;
  const componentGap = options?.componentGap ?? DEFAULT_COMPONENT_GAP;
  const components = buildConnectedComponents(nodes, edges);
  const positions: Record<string, { x: number; y: number }> = {};
  const componentLayouts: CanvasGraphLayoutComponent[] = [];
  let nextComponentY = anchor.y;
  let overallMaxX = anchor.x;
  let hasCycle = false;

  for (const componentNodes of components) {
    const layout = layoutComponent(componentNodes, edges, {
      columnGap,
      rowGap,
    });
    hasCycle = hasCycle || layout.hasCycle;

    for (const placement of layout.placements) {
      positions[placement.id] = {
        x: Math.round(anchor.x + placement.x),
        y: Math.round(nextComponentY + placement.y),
      };
      overallMaxX = Math.max(overallMaxX, anchor.x + placement.x + placement.width);
    }

    componentLayouts.push({
      nodeIds: layout.nodeIds,
      bounds: {
        x: anchor.x,
        y: nextComponentY,
        width: layout.bounds.width,
        height: layout.bounds.height,
      },
      hasCycle: layout.hasCycle,
    });

    nextComponentY += layout.bounds.height + componentGap;
  }

  const lastComponent = componentLayouts.at(-1);
  const overallHeight = lastComponent
    ? Math.max(0, lastComponent.bounds.y + lastComponent.bounds.height - anchor.y)
    : 0;

  return {
    positions,
    bounds: {
      x: anchor.x,
      y: anchor.y,
      width: Math.max(0, overallMaxX - anchor.x),
      height: overallHeight,
    },
    components: componentLayouts,
    hasCycle,
  };
}
