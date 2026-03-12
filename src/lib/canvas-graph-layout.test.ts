import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasGraphBounds,
  layoutCanvasGraph,
  type CanvasGraphLayoutEdge,
  type CanvasGraphLayoutNode,
} from "@/lib/canvas-graph-layout";

function createNode(
  id: string,
  patch?: Partial<CanvasGraphLayoutNode>
): CanvasGraphLayoutNode {
  return {
    id,
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    order: 0,
    ...patch,
  };
}

function createEdge(sourceNodeId: string, targetNodeId: string): CanvasGraphLayoutEdge {
  return {
    sourceNodeId,
    targetNodeId,
  };
}

function assertNoOverlap(
  result: ReturnType<typeof layoutCanvasGraph>,
  nodes: CanvasGraphLayoutNode[]
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const entries = Object.entries(result.positions);

  for (let index = 0; index < entries.length; index += 1) {
    const [leftId, leftPosition] = entries[index]!;
    const leftNode = byId.get(leftId);
    assert.ok(leftNode);

    for (let innerIndex = index + 1; innerIndex < entries.length; innerIndex += 1) {
      const [rightId, rightPosition] = entries[innerIndex]!;
      const rightNode = byId.get(rightId);
      assert.ok(rightNode);

      const overlapX =
        leftPosition.x < rightPosition.x + rightNode.width &&
        leftPosition.x + leftNode.width > rightPosition.x;
      const overlapY =
        leftPosition.y < rightPosition.y + rightNode.height &&
        leftPosition.y + leftNode.height > rightPosition.y;

      assert.equal(
        overlapX && overlapY,
        false,
        `Expected ${leftId} and ${rightId} not to overlap in the computed layout.`
      );
    }
  }
}

test("lays out a chain as a horizontal flow", () => {
  const nodes = [
    createNode("a", { x: 0, y: 10, order: 0 }),
    createNode("b", { x: 200, y: 30, order: 1 }),
    createNode("c", { x: 400, y: 50, order: 2 }),
  ];
  const result = layoutCanvasGraph(nodes, [createEdge("a", "b"), createEdge("b", "c")], {
    anchor: { x: 100, y: 200 },
    columnGap: 80,
    rowGap: 40,
    componentGap: 90,
  });

  assert.deepEqual(result.positions, {
    a: { x: 100, y: 200 },
    b: { x: 380, y: 200 },
    c: { x: 660, y: 200 },
  });
  assert.equal(result.hasCycle, false);
});

test("lays out a branched graph in ranked columns", () => {
  const nodes = [
    createNode("root", { x: 20, y: 10, order: 0 }),
    createNode("branch-a", { x: 180, y: 40, order: 1 }),
    createNode("branch-b", { x: 190, y: 200, order: 2 }),
  ];
  const result = layoutCanvasGraph(nodes, [createEdge("root", "branch-a"), createEdge("root", "branch-b")], {
    anchor: { x: 0, y: 0 },
    columnGap: 72,
    rowGap: 32,
    componentGap: 96,
  });

  assert.equal(result.positions.root?.x, 0);
  assert.equal(result.positions["branch-a"]?.x, result.positions["branch-b"]?.x);
  assert.ok((result.positions["branch-a"]?.x || 0) > (result.positions.root?.x || 0));
  assert.ok((result.positions["branch-b"]?.y || 0) > (result.positions["branch-a"]?.y || 0));
  assert.equal(result.components.length, 1);
});

test("stacks disconnected components vertically", () => {
  const nodes = [
    createNode("a", { x: 0, y: 10, order: 0 }),
    createNode("b", { x: 240, y: 10, order: 1 }),
    createNode("c", { x: 80, y: 400, order: 2 }),
  ];
  const result = layoutCanvasGraph(nodes, [createEdge("a", "b")], {
    anchor: { x: 50, y: 90 },
    columnGap: 60,
    rowGap: 32,
    componentGap: 75,
  });

  assert.equal(result.components.length, 2);
  assert.ok(result.positions.c!.y >= result.positions.a!.y + nodes[0]!.height + 75);
});

test("falls back to a stable row ordering for cycles", () => {
  const nodes = [
    createNode("a", { x: 0, y: 50, order: 0 }),
    createNode("b", { x: 0, y: 120, order: 1 }),
  ];
  const result = layoutCanvasGraph(nodes, [createEdge("a", "b"), createEdge("b", "a")], {
    anchor: { x: 20, y: 30 },
    columnGap: 90,
    rowGap: 32,
    componentGap: 96,
  });

  assert.equal(result.hasCycle, true);
  assert.deepEqual(result.components.map((component) => component.hasCycle), [true]);
  assert.equal(result.positions.a?.y, result.positions.b?.y);
  assert.ok((result.positions.b?.x || 0) > (result.positions.a?.x || 0));
});

test("preserves mixed node sizes without overlap", () => {
  const nodes = [
    createNode("a", { width: 240, height: 140, order: 0 }),
    createNode("b", { width: 360, height: 260, order: 1, y: 120 }),
    createNode("c", { width: 280, height: 100, order: 2, y: 260 }),
    createNode("d", { width: 180, height: 180, order: 3, y: 360 }),
  ];
  const result = layoutCanvasGraph(
    nodes,
    [createEdge("a", "b"), createEdge("a", "c"), createEdge("c", "d")],
    {
      anchor: { x: 0, y: 0 },
      columnGap: 88,
      rowGap: 44,
      componentGap: 100,
    }
  );

  assertNoOverlap(result, nodes);
});

test("returns stable output for repeated layout runs", () => {
  const nodes = [
    createNode("a", { x: 20, y: 10, order: 0 }),
    createNode("b", { x: 180, y: 50, order: 1 }),
    createNode("c", { x: 320, y: 120, order: 2 }),
  ];
  const edges = [createEdge("a", "b"), createEdge("a", "c")];

  const first = layoutCanvasGraph(nodes, edges, {
    anchor: { x: 40, y: 60 },
  });
  const second = layoutCanvasGraph(nodes, edges, {
    anchor: { x: 40, y: 60 },
  });

  assert.deepEqual(second, first);
});

test("computes graph bounds from positioned nodes", () => {
  const bounds = getCanvasGraphBounds([
    { x: 40, y: 60, width: 200, height: 120 },
    { x: 320, y: 110, width: 240, height: 160 },
  ]);

  assert.deepEqual(bounds, {
    x: 40,
    y: 60,
    width: 520,
    height: 210,
  });
});
