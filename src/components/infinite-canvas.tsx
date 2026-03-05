"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./infinite-canvas.module.css";

type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

type CanvasNode = {
  id: string;
  label: string;
  providerId: "openai" | "google-gemini" | "topaz";
  outputType: "image" | "video" | "text";
  sourceAssetId: string | null;
  sourceAssetMimeType: string | null;
  upstreamNodeIds: string[];
  x: number;
  y: number;
};

type Props = {
  nodes: CanvasNode[];
  selectedNodeIds: string[];
  viewport: CanvasViewport;
  onSelectSingleNode: (nodeId: string | null) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onMarqueeSelectNodes: (nodeIds: string[]) => void;
  onDropNode: (position: { x: number; y: number }) => void;
  onDropFiles: (files: File[], position: { x: number; y: number }) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  latestNodeStates: Record<string, string>;
};

type InteractionState =
  | {
      type: "idle";
    }
  | {
      type: "pan";
      startClientX: number;
      startClientY: number;
      startViewport: CanvasViewport;
    }
  | {
      type: "drag";
      nodeId: string;
      pointerOffsetX: number;
      pointerOffsetY: number;
    }
  | {
      type: "connect";
      sourceNodeId: string;
    }
  | {
      type: "marquee";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    };

const DEFAULT_NODE_WIDTH = 212;
const DEFAULT_NODE_HEIGHT = 72;
const LINE_DELTA_PX = 16;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInputPortPoint(node: CanvasNode, size: { width: number; height: number }) {
  return {
    x: node.x,
    y: node.y + size.height / 2,
  };
}

function getOutputPortPoint(node: CanvasNode, size: { width: number; height: number }) {
  return {
    x: node.x + size.width,
    y: node.y + size.height / 2,
  };
}

function curvePath(startX: number, startY: number, endX: number, endY: number) {
  const controlOffset = Math.max(48, Math.abs(endX - startX) * 0.46);
  return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

function normalizeWheelDelta(deltaY: number, deltaMode: number) {
  if (deltaMode === 1) {
    return deltaY * LINE_DELTA_PX;
  }
  if (deltaMode === 2) {
    return deltaY * window.innerHeight;
  }
  return deltaY;
}

export function InfiniteCanvas({
  nodes,
  selectedNodeIds,
  viewport,
  onSelectSingleNode,
  onToggleNodeSelection,
  onMarqueeSelectNodes,
  onDropNode,
  onDropFiles,
  onViewportChange,
  onNodePositionChange,
  onConnectNodes,
  latestNodeStates,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [view, setView] = useState<CanvasViewport>(viewport);
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const viewRef = useRef<CanvasViewport>(viewport);
  const interactionRef = useRef<InteractionState>({ type: "idle" });
  const viewportTimer = useRef<NodeJS.Timeout | null>(null);
  const gestureRef = useRef<{
    active: boolean;
    startView: CanvasViewport;
    originX: number;
    originY: number;
    worldX: number;
    worldY: number;
  }>({
    active: false,
    startView: viewport,
    originX: 0,
    originY: 0,
    worldX: 0,
    worldY: 0,
  });
  const [connectionDraft, setConnectionDraft] = useState<{
    sourceNodeId: string;
    targetX: number;
    targetY: number;
  } | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  const nodesById = useMemo(() => {
    return nodes.reduce<Record<string, CanvasNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [nodes]);

  const getNodeSize = useCallback(
    (nodeId: string) => {
      return nodeSizes[nodeId] || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
    },
    [nodeSizes]
  );

  useLayoutEffect(() => {
    const next: Record<string, { width: number; height: number }> = {};
    for (const node of nodes) {
      const element = nodeElementRefs.current[node.id];
      if (!element) {
        continue;
      }
      next[node.id] = {
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    }

    setNodeSizes((prev) => {
      const nextKeys = Object.keys(next);
      const prevKeys = Object.keys(prev);
      if (nextKeys.length !== prevKeys.length) {
        return next;
      }

      for (const key of nextKeys) {
        const nextSize = next[key];
        const prevSize = prev[key];
        if (!prevSize || prevSize.width !== nextSize.width || prevSize.height !== nextSize.height) {
          return next;
        }
      }

      return prev;
    });
  }, [latestNodeStates, nodes, selectedNodeIds]);

  const edges = useMemo(() => {
    return nodes.flatMap((targetNode) => {
      return targetNode.upstreamNodeIds
        .map((sourceNodeId) => {
          const sourceNode = nodesById[sourceNodeId];
          if (!sourceNode) {
            return null;
          }

          const start = getOutputPortPoint(sourceNode, getNodeSize(sourceNode.id));
          const end = getInputPortPoint(targetNode, getNodeSize(targetNode.id));

          return {
            id: `${sourceNodeId}->${targetNode.id}`,
            start,
            end,
          };
        })
        .filter((edge): edge is { id: string; start: { x: number; y: number }; end: { x: number; y: number } } =>
          Boolean(edge)
        );
    });
  }, [getNodeSize, nodes, nodesById]);

  useEffect(() => {
    setView(viewport);
    viewRef.current = viewport;
  }, [viewport]);

  const toWorldPoint = useCallback((clientX: number, clientY: number, targetView = viewRef.current) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left - targetView.x) / targetView.zoom,
      y: (clientY - rect.top - targetView.y) / targetView.zoom,
    };
  }, []);

  const scheduleViewportCommit = useCallback(
    (next: CanvasViewport) => {
      if (viewportTimer.current) {
        clearTimeout(viewportTimer.current);
      }

      viewportTimer.current = setTimeout(() => {
        onViewportChange(next);
      }, 280);
    },
    [onViewportChange]
  );

  const handleWheelEvent = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();

      const current = viewRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
      const sensitivity = event.ctrlKey ? 0.0012 : 0.0009;
      const zoomFactor = Math.exp(-normalizedDeltaY * sensitivity);
      const nextZoom = clamp(current.zoom * zoomFactor, 0.35, 2.4);
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const worldX = (cursorX - current.x) / current.zoom;
      const worldY = (cursorY - current.y) / current.zoom;
      const next: CanvasViewport = {
        zoom: nextZoom,
        x: cursorX - worldX * nextZoom,
        y: cursorY - worldY * nextZoom,
      };

      viewRef.current = next;
      setView(next);
      scheduleViewportCommit(next);
    },
    [scheduleViewportCommit]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction.type === "idle") {
        return;
      }

      if (interaction.type === "pan") {
        const next: CanvasViewport = {
          ...interaction.startViewport,
          x: interaction.startViewport.x + (event.clientX - interaction.startClientX),
          y: interaction.startViewport.y + (event.clientY - interaction.startClientY),
        };

        viewRef.current = next;
        setView(next);
        scheduleViewportCommit(next);
        return;
      }

      if (interaction.type === "drag") {
        const point = toWorldPoint(event.clientX, event.clientY);
        onNodePositionChange(interaction.nodeId, {
          x: point.x - interaction.pointerOffsetX,
          y: point.y - interaction.pointerOffsetY,
        });
        return;
      }

      if (interaction.type === "marquee") {
        const point = toWorldPoint(event.clientX, event.clientY);
        interactionRef.current = {
          ...interaction,
          endX: point.x,
          endY: point.y,
        };
        setMarqueeDraft({
          startX: interaction.startX,
          startY: interaction.startY,
          endX: point.x,
          endY: point.y,
        });
        return;
      }

      const point = toWorldPoint(event.clientX, event.clientY);
      setConnectionDraft({
        sourceNodeId: interaction.sourceNodeId,
        targetX: point.x,
        targetY: point.y,
      });
    },
    [onNodePositionChange, scheduleViewportCommit, toWorldPoint]
  );

  const handlePointerUp = useCallback(() => {
    const interaction = interactionRef.current;
    if (interaction.type === "connect") {
      setConnectionDraft(null);
    }

    if (interaction.type === "marquee") {
      const minX = Math.min(interaction.startX, interaction.endX);
      const maxX = Math.max(interaction.startX, interaction.endX);
      const minY = Math.min(interaction.startY, interaction.endY);
      const maxY = Math.max(interaction.startY, interaction.endY);

      const selectedIds = nodes
        .filter((node) => {
          const size = getNodeSize(node.id);
          const nodeMinX = node.x;
          const nodeMaxX = node.x + size.width;
          const nodeMinY = node.y;
          const nodeMaxY = node.y + size.height;

          return !(nodeMaxX < minX || nodeMinX > maxX || nodeMaxY < minY || nodeMinY > maxY);
        })
        .map((node) => node.id);

      if (selectedIds.length > 0) {
        onMarqueeSelectNodes(selectedIds);
      }

      setMarqueeDraft(null);
    }

    interactionRef.current = { type: "idle" };
  }, [getNodeSize, nodes, onMarqueeSelectNodes]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  useEffect(() => {
    return () => {
      if (viewportTimer.current) {
        clearTimeout(viewportTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Use native non-passive wheel handling so trackpad pinch/zoom can be
    // intercepted and mapped to canvas zoom without browser page zoom.
    const onWheelNative = (event: WheelEvent) => {
      handleWheelEvent(event);
    };

    container.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheelNative);
    };
  }, [handleWheelEvent]);

  useEffect(() => {
    // Browser page zoom (ctrl/cmd + wheel) is handled at document level.
    // Capture and cancel it when the event target is inside this canvas.
    const onGlobalWheel = (event: WheelEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const target = event.target as Node | null;
      if (!target || !container.contains(target)) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", onGlobalWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onGlobalWheel, true);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Safari emits non-standard GestureEvents for pinch. We handle them to keep
    // pinch zoom inside canvas instead of browser page zoom.
    const onGestureStart = (event: Event) => {
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const maybeGesture = event as Event & { clientX?: number; clientY?: number };
      const clientX = typeof maybeGesture.clientX === "number" ? maybeGesture.clientX : rect.left + rect.width / 2;
      const clientY = typeof maybeGesture.clientY === "number" ? maybeGesture.clientY : rect.top + rect.height / 2;
      const originX = clientX - rect.left;
      const originY = clientY - rect.top;
      const startView = viewRef.current;

      gestureRef.current = {
        active: true,
        startView,
        originX,
        originY,
        worldX: (originX - startView.x) / startView.zoom,
        worldY: (originY - startView.y) / startView.zoom,
      };
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (!gestureRef.current.active) {
        return;
      }

      const maybeGesture = event as Event & { scale?: number };
      const gestureScale = typeof maybeGesture.scale === "number" && maybeGesture.scale > 0 ? maybeGesture.scale : 1;
      const nextZoom = clamp(gestureRef.current.startView.zoom * gestureScale, 0.35, 2.4);
      const next: CanvasViewport = {
        zoom: nextZoom,
        x: gestureRef.current.originX - gestureRef.current.worldX * nextZoom,
        y: gestureRef.current.originY - gestureRef.current.worldY * nextZoom,
      };

      viewRef.current = next;
      setView(next);
      scheduleViewportCommit(next);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureRef.current.active = false;
    };

    container.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    container.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    container.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });

    return () => {
      container.removeEventListener("gesturestart", onGestureStart as EventListener);
      container.removeEventListener("gesturechange", onGestureChange as EventListener);
      container.removeEventListener("gestureend", onGestureEnd as EventListener);
    };
  }, [scheduleViewportCommit, viewport]);

  const onBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      if (event.shiftKey) {
        const point = toWorldPoint(event.clientX, event.clientY);
        interactionRef.current = {
          type: "marquee",
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        };
        setMarqueeDraft({
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        });
        return;
      }

      onSelectSingleNode(null);
      interactionRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewRef.current,
      };
    },
    [onSelectSingleNode, toWorldPoint]
  );

  const onNodePointerDown = useCallback(
    (node: CanvasNode, event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        onToggleNodeSelection(node.id);
        return;
      }

      const point = toWorldPoint(event.clientX, event.clientY);
      interactionRef.current = {
        type: "drag",
        nodeId: node.id,
        pointerOffsetX: point.x - node.x,
        pointerOffsetY: point.y - node.y,
      };

      onSelectSingleNode(node.id);
    },
    [onSelectSingleNode, onToggleNodeSelection, toWorldPoint]
  );

  const onOutputPortPointerDown = useCallback(
    (node: CanvasNode, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();

      const source = getOutputPortPoint(node, getNodeSize(node.id));
      interactionRef.current = {
        type: "connect",
        sourceNodeId: node.id,
      };
      setConnectionDraft({
        sourceNodeId: node.id,
        targetX: source.x,
        targetY: source.y,
      });
      onSelectSingleNode(node.id);
    },
    [getNodeSize, onSelectSingleNode]
  );

  const onInputPortPointerUp = useCallback(
    (targetNodeId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();

      const interaction = interactionRef.current;
      if (interaction.type !== "connect") {
        return;
      }

      if (interaction.sourceNodeId !== targetNodeId) {
        onConnectNodes(interaction.sourceNodeId, targetNodeId);
      }

      interactionRef.current = { type: "idle" };
      setConnectionDraft(null);
    },
    [onConnectNodes]
  );

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const point = toWorldPoint(event.clientX, event.clientY);
      onDropNode(point);
    },
    [onDropNode, toWorldPoint]
  );

  const draftPath = useMemo(() => {
    if (!connectionDraft) {
      return null;
    }

    const sourceNode = nodesById[connectionDraft.sourceNodeId];
    if (!sourceNode) {
      return null;
    }

    const start = getOutputPortPoint(sourceNode, getNodeSize(sourceNode.id));
    return curvePath(start.x, start.y, connectionDraft.targetX, connectionDraft.targetY);
  }, [connectionDraft, getNodeSize, nodesById]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (node.upstreamNodeIds.length > 0) {
        ids.add(node.id);
      }
      for (const upstreamNodeId of node.upstreamNodeIds) {
        ids.add(upstreamNodeId);
      }
    }
    return ids;
  }, [nodes]);

  return (
    <div
      ref={containerRef}
      className={styles.canvasRoot}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={onDoubleClick}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length === 0) {
          return;
        }
        const point = toWorldPoint(event.clientX, event.clientY);
        onDropFiles(files, point);
      }}
    >
      <div
        className={styles.world}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className={styles.connectionLayer} aria-hidden="true">
          {edges.map((edge) => (
            <path
              key={edge.id}
              className={styles.connection}
              d={curvePath(edge.start.x, edge.start.y, edge.end.x, edge.end.y)}
            />
          ))}
          {draftPath ? <path className={styles.connectionDraft} d={draftPath} /> : null}
        </svg>

        {nodes.map((node) => {
          const hasImageSource = Boolean(node.sourceAssetId && node.outputType === "image");
          const hasNonImageSource = Boolean(node.sourceAssetId && node.outputType !== "image");

          return (
            <div
              key={node.id}
              ref={(element) => {
                nodeElementRefs.current[node.id] = element;
              }}
              role="button"
              tabIndex={0}
              className={`${styles.node} ${selectedNodeIds.includes(node.id) ? styles.nodeSelected : ""} ${hasImageSource ? styles.nodeWithImage : ""} ${connectedNodeIds.has(node.id) ? styles.nodeConnected : ""}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => onNodePointerDown(node, event)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectSingleNode(node.id);
                }
              }}
            >
              <button
                type="button"
                className={`${styles.port} ${styles.inputPort}`}
                onPointerUp={(event) => onInputPortPointerUp(node.id, event)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Connect input to ${node.label}`}
              />

              <button
                type="button"
                className={`${styles.port} ${styles.outputPort}`}
                onPointerDown={(event) => onOutputPortPointerDown(node, event)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Start output connection from ${node.label}`}
              />

              {hasImageSource ? (
                <div
                  className={styles.sourcePreviewFrame}
                  style={{
                    aspectRatio: imageAspectRatios[node.id] ? String(imageAspectRatios[node.id]) : "1.33",
                  }}
                >
                  <img
                    className={styles.sourcePreviewImage}
                    src={`/api/assets/${node.sourceAssetId}/file`}
                    alt={`${node.label} source`}
                    draggable={false}
                    onLoad={(event) => {
                      const target = event.currentTarget;
                      if (!target.naturalWidth || !target.naturalHeight) {
                        return;
                      }
                      const nextRatio = target.naturalWidth / target.naturalHeight;
                      if (!Number.isFinite(nextRatio) || nextRatio <= 0) {
                        return;
                      }

                      setImageAspectRatios((prev) => {
                        const currentRatio = prev[node.id];
                        if (currentRatio && Math.abs(currentRatio - nextRatio) < 0.005) {
                          return prev;
                        }
                        return {
                          ...prev,
                          [node.id]: nextRatio,
                        };
                      });
                    }}
                  />
                  <div className={styles.imageNodeOverlay}>
                    <div className={styles.nodeTitle}>
                      <span>{node.label}</span>
                      <span className={styles.statusBubble}>{latestNodeStates[node.id] || "idle"}</span>
                    </div>
                    <div className={styles.nodeBody}>
                      <span>{node.providerId}</span>
                      <span>{node.outputType}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.nodeTitle}>
                    <span>{node.label}</span>
                    <span className={styles.statusBubble}>{latestNodeStates[node.id] || "idle"}</span>
                  </div>
                  <div className={styles.nodeBody}>
                    <span>{node.providerId}</span>
                    <span>{node.outputType}</span>
                  </div>
                </>
              )}

              {hasNonImageSource ? (
                <div className={styles.sourceBadge}>{`${node.outputType.toUpperCase()} source`}</div>
              ) : null}
            </div>
          );
        })}

        {marqueeDraft ? (
          <div
            className={styles.marquee}
            style={{
              left: `${Math.min(marqueeDraft.startX, marqueeDraft.endX)}px`,
              top: `${Math.min(marqueeDraft.startY, marqueeDraft.endY)}px`,
              width: `${Math.abs(marqueeDraft.endX - marqueeDraft.startX)}px`,
              height: `${Math.abs(marqueeDraft.endY - marqueeDraft.startY)}px`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
