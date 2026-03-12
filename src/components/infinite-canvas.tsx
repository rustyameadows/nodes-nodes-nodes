"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getAssetFileUrl } from "@/components/workspace/client-api";
import type { WorkflowNodeSize } from "@/components/workspace/types";
import type {
  CanvasAccentType,
  CanvasConnection,
  CanvasInsertRequest,
  CanvasPhantomPreview,
  CanvasRenderNode,
} from "@/components/canvas-node-types";
import {
  clampWorkflowNodeSize,
  resolveCanvasNodeFrameSize,
  shouldCanvasNodeMeasureContentHeight,
} from "@/lib/canvas-node-presentation";
import { getUploadedAssetNodeAspectRatio } from "@/lib/canvas-asset-nodes";
import { sortCanvasNodesForDisplay } from "@/lib/canvas-layout";
import { buildCanvasConnections } from "@/lib/canvas-connections";
import {
  getCanvasNodeAccentColor,
  getCanvasNodeAccentGlow,
  getCanvasNodeBorderLayers,
  resolveCanvasNodeBorderSemantics,
} from "@/lib/canvas-node-design-system";
import { isRunnableOpenAiImageModel, parseImageSize } from "@/lib/openai-image-settings";
import { isRunnableTopazGigapixelModel } from "@/lib/topaz-gigapixel-settings";
import styles from "./infinite-canvas.module.css";
import nodeStyles from "@/components/canvas-nodes/canvas-node.module.css";

type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

type Props = {
  nodes: CanvasRenderNode[];
  selectedNodeIds: string[];
  selectedConnectionId: string | null;
  viewport: CanvasViewport;
  onSelectSingleNode: (nodeId: string | null) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onMarqueeSelectNodes: (nodeIds: string[]) => void;
  onRequestInsertMenu: (request: CanvasInsertRequest) => void;
  onDropFiles: (files: File[], position: { x: number; y: number }) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onViewportInteractionStart?: () => void;
  onCommitNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  onStartNodeResize?: (nodeId: string, size: WorkflowNodeSize) => void;
  onCommitNodeSize: (nodeId: string, size: WorkflowNodeSize) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onSelectConnection: (connection: CanvasConnection | null) => void;
  onNodeActivate: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  renderNodeContent: (node: CanvasRenderNode) => ReactNode;
  activePhantomPreview?: CanvasPhantomPreview | null;
  onRunActiveNode?: (nodeId: string) => void;
  enableProgrammaticViewportMotion?: boolean;
  programmaticMotionNodeIds?: string[];
  programmaticMotionFrameSizes?: Record<string, WorkflowNodeSize>;
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
      nodeIds: string[];
      anchorNodeId: string;
      anchorStartX: number;
      anchorStartY: number;
      pointerOffsetX: number;
      pointerOffsetY: number;
      initialPositions: Record<string, { x: number; y: number }>;
    }
  | {
      type: "connect";
      nodeId: string;
      port: "input" | "output";
    }
  | {
      type: "marquee";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }
  | {
      type: "resize";
      nodeId: string;
      startClientX: number;
      startClientY: number;
      startSize: { width: number; height: number };
      aspectRatio: number | null;
    };

const DEFAULT_NODE_WIDTH = 212;
const DEFAULT_NODE_HEIGHT = 72;
const LINE_DELTA_PX = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.00125;
const GESTURE_ZOOM_SENSITIVITY = 0.00165;
const PINCH_ZOOM_EXPONENT = 1.18;
function semanticColor(type: CanvasAccentType) {
  return getCanvasNodeAccentColor(type);
}

function semanticGlow(type: CanvasAccentType) {
  return getCanvasNodeAccentGlow(type);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInputPortPoint(node: CanvasRenderNode, size: { width: number; height: number }) {
  return {
    x: node.x,
    y: node.y + size.height / 2,
  };
}

function getOutputPortPoint(node: CanvasRenderNode, size: { width: number; height: number }) {
  return {
    x: node.x + size.width,
    y: node.y + size.height / 2,
  };
}

function usesContentHeight(node: CanvasRenderNode) {
  return shouldCanvasNodeMeasureContentHeight({
    kind: node.kind,
    renderMode: node.renderMode,
  });
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

function getNodeOutputSemanticType(node: CanvasRenderNode) {
  return node.outputSemanticType || node.outputType;
}

function getNodeOutputAccentType(node: CanvasRenderNode): CanvasAccentType {
  if (node.kind === "model") {
    return "citrus";
  }
  return getNodeOutputSemanticType(node);
}

function isGeneratedTextNoteNode(node: CanvasRenderNode) {
  return (
    node.kind === "text-note" &&
    (node.settings.source === "generated-model-text" || node.settings.source === "template-output")
  );
}

function isEditableElement(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function isGeneratedAssetNode(node: CanvasRenderNode) {
  return node.kind === "asset-source" && node.assetOrigin === "generated";
}

function getImageFrameAspectRatio(
  node: CanvasRenderNode,
  nodesById: Record<string, CanvasRenderNode>,
  imageAspectRatios: Record<string, number>
) {
  const uploadedAssetRatio = getUploadedAssetNodeAspectRatio(node);
  if (uploadedAssetRatio) {
    return uploadedAssetRatio;
  }

  const measuredRatio = imageAspectRatios[node.id];
  if (measuredRatio) {
    return measuredRatio;
  }

  if (!isGeneratedAssetNode(node)) {
    return 1.33;
  }

  const sourceModelNodeId = node.sourceModelNodeId;
  const sourceModelNode = sourceModelNodeId ? nodesById[sourceModelNodeId] : null;
  if (!sourceModelNode || sourceModelNode.kind !== "model") {
    return 1;
  }

  if (isRunnableOpenAiImageModel(sourceModelNode.providerId, sourceModelNode.modelId)) {
    const sizeSetting = sourceModelNode.settings.size;
    const parsedSize =
      sizeSetting === "1024x1024" || sizeSetting === "1536x1024" || sizeSetting === "1024x1536" || sizeSetting === "auto"
        ? parseImageSize(sizeSetting)
        : null;
    if (parsedSize) {
      return parsedSize.width / parsedSize.height;
    }

    for (const upstreamNodeId of sourceModelNode.upstreamNodeIds) {
      const inputNode = nodesById[upstreamNodeId];
      if (!inputNode || inputNode.outputType !== "image") {
        continue;
      }

      const inputRatio = imageAspectRatios[inputNode.id];
      if (inputRatio) {
        return inputRatio;
      }
    }
  }

  if (isRunnableTopazGigapixelModel(sourceModelNode.providerId, sourceModelNode.modelId)) {
    for (const upstreamNodeId of sourceModelNode.upstreamNodeIds) {
      const inputNode = nodesById[upstreamNodeId];
      if (!inputNode || inputNode.outputType !== "image") {
        continue;
      }

      const inputRatio = imageAspectRatios[inputNode.id];
      if (inputRatio) {
        return inputRatio;
      }
    }
  }

  return 1;
}

function getInputAccentGradient(inputSemanticTypes: CanvasAccentType[] | undefined) {
  const filteredTypes = (inputSemanticTypes || []).filter((type, index, values) => values.indexOf(type) === index);
  if (filteredTypes.length === 0) {
    return "transparent";
  }

  if (filteredTypes.length === 1) {
    const color = semanticColor(filteredTypes[0]);
    return `linear-gradient(to bottom, ${color}, ${color})`;
  }

  const step = 100 / filteredTypes.length;
  const stops = filteredTypes
    .map((type, index) => {
      const start = index * step;
      const end = start + step;
      const color = semanticColor(type);
      return `${color} ${start}%, ${color} ${end}%`;
    })
    .join(", ");

  return `linear-gradient(to bottom, ${stops})`;
}

function getBorderGradient(leftAccentTypes: CanvasAccentType[], rightAccentType: CanvasAccentType) {
  const orderedTypes = [...leftAccentTypes, rightAccentType].filter((type, index, allTypes) => {
    if (index === 0) {
      return true;
    }
    return allTypes[index - 1] !== type;
  });

  if (orderedTypes.length === 0) {
    const neutral = semanticColor("neutral");
    return `linear-gradient(90deg, ${neutral} 0%, ${neutral} 100%)`;
  }

  if (orderedTypes.length === 1) {
    const color = semanticColor(orderedTypes[0]);
    return `linear-gradient(90deg, ${color} 0%, ${color} 100%)`;
  }

  const uniqueLeftTypes = leftAccentTypes.filter((type, index) => leftAccentTypes.indexOf(type) === index);
  if (uniqueLeftTypes.length > 1 && rightAccentType === "citrus") {
    const upperLeft = semanticColor(uniqueLeftTypes[0]);
    const lowerLeft = semanticColor(uniqueLeftTypes[1]);
    const citrus = semanticColor("citrus");
    const upperBlend = `color-mix(in srgb, ${upperLeft} 56%, ${citrus} 44%)`;
    const lowerBlend = `color-mix(in srgb, ${lowerLeft} 56%, ${citrus} 44%)`;
    const leftBlend = `color-mix(in srgb, ${upperLeft} 50%, ${lowerLeft} 50%)`;

    return `conic-gradient(
      from 0deg at 50% 50%,
      ${citrus} 0deg 174deg,
      ${lowerBlend} 180deg,
      ${lowerLeft} 186deg 264deg,
      ${leftBlend} 270deg,
      ${upperLeft} 276deg 354deg,
      ${upperBlend} 360deg,
      ${citrus} 360deg
    )`;
  }

  const step = 100 / orderedTypes.length;
  const blendWidth = Math.min(10, step * 0.42);
  const stops: string[] = [];

  orderedTypes.forEach((type, index) => {
    const color = semanticColor(type);
    if (index === 0) {
      stops.push(`${color} 0%`);
    }

    if (index === orderedTypes.length - 1) {
      stops.push(`${color} 100%`);
      return;
    }

    const nextColor = semanticColor(orderedTypes[index + 1]);
    const boundary = (index + 1) * step;
    const blendStart = Math.max(index * step, boundary - blendWidth / 2);
    const blendEnd = Math.min((index + 2) * step, boundary + blendWidth / 2);
    const mixedColor = `color-mix(in srgb, ${color} 50%, ${nextColor} 50%)`;

    stops.push(
      `${color} ${blendStart}%`,
      `${mixedColor} ${boundary}%`,
      `${nextColor} ${blendEnd}%`
    );
  });

  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function getSelectionHaloColors(
  leftAccentTypes: CanvasAccentType[],
  rightAccentType: CanvasAccentType
) {
  const uniqueLeftTypes = leftAccentTypes.filter((type, index) => leftAccentTypes.indexOf(type) === index);
  const leftTop = uniqueLeftTypes[0] || "neutral";
  const leftBottom = uniqueLeftTypes[1] || leftTop;
  return {
    leftTop: semanticColor(leftTop),
    leftBottom: semanticColor(leftBottom),
    right: semanticColor(rightAccentType),
  };
}

export function InfiniteCanvas({
  nodes,
  selectedNodeIds,
  selectedConnectionId,
  viewport,
  onSelectSingleNode,
  onToggleNodeSelection,
  onMarqueeSelectNodes,
  onRequestInsertMenu,
  onDropFiles,
  onViewportChange,
  onViewportInteractionStart,
  onCommitNodePositions,
  onStartNodeResize,
  onCommitNodeSize,
  onConnectNodes,
  onSelectConnection,
  onNodeActivate,
  onNodeDoubleClick,
  renderNodeContent,
  activePhantomPreview,
  onRunActiveNode,
  enableProgrammaticViewportMotion = false,
  programmaticMotionNodeIds = [],
  programmaticMotionFrameSizes = {},
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [view, setView] = useState<CanvasViewport>(viewport);
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [interactionMode, setInteractionMode] = useState<InteractionState["type"]>("idle");
  const viewRef = useRef<CanvasViewport>(viewport);
  const interactionRef = useRef<InteractionState>({ type: "idle" });
  const viewportTimer = useRef<NodeJS.Timeout | null>(null);
  const previousBodySelectionRef = useRef<{
    userSelect: string;
    webkitUserSelect: string;
  } | null>(null);
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
    nodeId: string;
    port: "input" | "output";
    targetX: number;
    targetY: number;
  } | null>(null);
  const [dragDraftPositions, setDragDraftPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [resizeDraftSizes, setResizeDraftSizes] = useState<Record<string, { width: number; height: number }> | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const programmaticMotionNodeIdSet = useMemo(() => new Set(programmaticMotionNodeIds), [programmaticMotionNodeIds]);

  const displayNodes = useMemo(() => {
    const laidOutNodes = !dragDraftPositions
      ? nodes
      : nodes.map((node) =>
          dragDraftPositions[node.id]
            ? {
                ...node,
                x: dragDraftPositions[node.id].x,
                y: dragDraftPositions[node.id].y,
              }
            : node
        );

    return sortCanvasNodesForDisplay(laidOutNodes);
  }, [dragDraftPositions, nodes]);

  const nodesById = useMemo(() => {
    return displayNodes.reduce<Record<string, CanvasRenderNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});
  }, [displayNodes]);

  const getNodeSize = useCallback(
    (nodeId: string) => {
      const resized = resizeDraftSizes?.[nodeId];
      const programmaticFrameSize = programmaticMotionFrameSizes[nodeId];
      const node = nodesById[nodeId];
      const measured = nodeSizes[nodeId];

      if (!node) {
        if (resized) {
          return resized;
        }
        if (programmaticFrameSize) {
          return programmaticFrameSize;
        }
        if (measured) {
          return measured;
        }
        return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      }

      return resolveCanvasNodeFrameSize({
        kind: node.kind,
        renderMode: node.renderMode,
        resolvedSize: programmaticFrameSize || node.resolvedSize,
        measuredSize: programmaticFrameSize ? null : measured,
        resizeDraftSize: resized,
        fallbackSize: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
      });
    },
    [nodeSizes, nodesById, programmaticMotionFrameSizes, resizeDraftSizes]
  );

  const getNodeBoundsSize = useCallback(
    (nodeId: string) => {
      const measured = nodeSizes[nodeId];
      if (measured) {
        return measured;
      }

      return getNodeSize(nodeId);
    },
    [getNodeSize, nodeSizes]
  );

  useLayoutEffect(() => {
    const next: Record<string, { width: number; height: number }> = {};
    for (const node of displayNodes) {
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
  }, [displayNodes, selectedNodeIds]);

  const edges = useMemo(() => {
    return buildCanvasConnections(displayNodes)
      .map((connection) => {
        const sourceNode = nodesById[connection.sourceNodeId];
        const targetNode = nodesById[connection.targetNodeId];
        if (!sourceNode || !targetNode) {
          return null;
        }

        const start = getOutputPortPoint(sourceNode, getNodeBoundsSize(sourceNode.id));
        const end = getInputPortPoint(targetNode, getNodeBoundsSize(targetNode.id));

        return {
          ...connection,
          start,
          end,
        };
      })
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
  }, [displayNodes, getNodeBoundsSize, nodesById]);

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

  const clearConnectionDraft = useCallback(() => {
    interactionRef.current = { type: "idle" };
    setInteractionMode("idle");
    setConnectionDraft(null);
  }, []);

  const isCanvasBackgroundTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false;
    }
    const container = containerRef.current;
    if (!container || !container.contains(target)) {
      return false;
    }
    if (target.closest(`.${styles.node}`) || target.closest(`.${styles.port}`)) {
      return false;
    }
    return true;
  }, []);

  const commitConnection = useCallback(
    (draftNodeId: string, draftPort: "input" | "output", targetNodeId: string, targetPort: "input" | "output") => {
      if (draftNodeId === targetNodeId || draftPort === targetPort) {
        clearConnectionDraft();
        return;
      }

      const sourceNodeId = draftPort === "output" ? draftNodeId : targetNodeId;
      const normalizedTargetNodeId = draftPort === "output" ? targetNodeId : draftNodeId;
      onConnectNodes(sourceNodeId, normalizedTargetNodeId);
      clearConnectionDraft();
    },
    [clearConnectionDraft, onConnectNodes]
  );

  const handleWheelEvent = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      onViewportInteractionStart?.();

      const current = viewRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
      const sensitivity = event.ctrlKey ? GESTURE_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
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
    [onViewportInteractionStart, scheduleViewportCommit]
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
        const nextAnchorX = point.x - interaction.pointerOffsetX;
        const nextAnchorY = point.y - interaction.pointerOffsetY;
        const deltaX = nextAnchorX - interaction.anchorStartX;
        const deltaY = nextAnchorY - interaction.anchorStartY;

        setDragDraftPositions(
          interaction.nodeIds.reduce<Record<string, { x: number; y: number }>>((acc, nodeId) => {
            const startPosition = interaction.initialPositions[nodeId];
            if (!startPosition) {
              return acc;
            }

            acc[nodeId] = {
              x: Math.round(startPosition.x + deltaX),
              y: Math.round(startPosition.y + deltaY),
            };
            return acc;
          }, {})
        );
        return;
      }

      if (interaction.type === "resize") {
        const node = nodesById[interaction.nodeId];
        if (!node) {
          return;
        }

        const nextWidth = interaction.startSize.width + (event.clientX - interaction.startClientX) / viewRef.current.zoom;
        const nextHeight = interaction.startSize.height + (event.clientY - interaction.startClientY) / viewRef.current.zoom;
        const unclamped =
          interaction.aspectRatio && interaction.aspectRatio > 0
            ? (() => {
                const widthDelta = nextWidth - interaction.startSize.width;
                const heightDelta = nextHeight - interaction.startSize.height;
                const dominantDelta =
                  Math.abs(widthDelta) >= Math.abs(heightDelta) * interaction.aspectRatio ? widthDelta : heightDelta * interaction.aspectRatio;
                const width = interaction.startSize.width + dominantDelta;
                return {
                  width,
                  height: width / interaction.aspectRatio,
                };
              })()
            : {
                width: nextWidth,
                height: nextHeight,
              };
        const size = clampWorkflowNodeSize(node, unclamped, interaction.aspectRatio || undefined);
        setResizeDraftSizes({
          [node.id]: size,
        });
        return;
      }

      if (interaction.type === "marquee") {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
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
        nodeId: interaction.nodeId,
        port: interaction.port,
        targetX: point.x,
        targetY: point.y,
      });
    },
    [nodesById, scheduleViewportCommit, toWorldPoint]
  );

  const handlePointerUp = useCallback((event: PointerEvent) => {
    const interaction = interactionRef.current;
    if (interaction.type === "connect") {
      if (isCanvasBackgroundTarget(event.target)) {
        const point = toWorldPoint(event.clientX, event.clientY);
        onRequestInsertMenu({
          ...point,
          clientX: event.clientX,
          clientY: event.clientY,
          connectionNodeId: interaction.nodeId,
          connectionPort: interaction.port,
        });
      }
      clearConnectionDraft();
    }

    if (interaction.type === "drag") {
      if (dragDraftPositions && Object.keys(dragDraftPositions).length > 0) {
        onCommitNodePositions(dragDraftPositions);
      }
      setDragDraftPositions(null);
    }

    if (interaction.type === "resize") {
      const nextSize = resizeDraftSizes?.[interaction.nodeId];
      if (nextSize) {
        onCommitNodeSize(interaction.nodeId, nextSize);
      }
      setResizeDraftSizes(null);
    }

    if (interaction.type === "marquee") {
      const minX = Math.min(interaction.startX, interaction.endX);
      const maxX = Math.max(interaction.startX, interaction.endX);
      const minY = Math.min(interaction.startY, interaction.endY);
      const maxY = Math.max(interaction.startY, interaction.endY);

      const selectedIds = nodes
        .filter((node) => {
          const size = getNodeBoundsSize(node.id);
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
    setInteractionMode("idle");
  }, [
    clearConnectionDraft,
    dragDraftPositions,
    getNodeBoundsSize,
    getNodeSize,
    isCanvasBackgroundTarget,
    nodes,
    onCommitNodePositions,
    onCommitNodeSize,
    onMarqueeSelectNodes,
    onRequestInsertMenu,
    toWorldPoint,
    resizeDraftSizes,
  ]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      onSelectConnection(null);
      if (interactionRef.current.type === "connect") {
        event.preventDefault();
        clearConnectionDraft();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [clearConnectionDraft, onSelectConnection]);

  useEffect(() => {
    if (!marqueeDraft) {
      if (previousBodySelectionRef.current) {
        document.body.style.userSelect = previousBodySelectionRef.current.userSelect;
        document.body.style.webkitUserSelect = previousBodySelectionRef.current.webkitUserSelect;
        previousBodySelectionRef.current = null;
      }
      return;
    }

    if (!previousBodySelectionRef.current) {
      previousBodySelectionRef.current = {
        userSelect: document.body.style.userSelect,
        webkitUserSelect: document.body.style.webkitUserSelect,
      };
    }

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();

    return () => {
      if (!previousBodySelectionRef.current) {
        return;
      }
      document.body.style.userSelect = previousBodySelectionRef.current.userSelect;
      document.body.style.webkitUserSelect = previousBodySelectionRef.current.webkitUserSelect;
      previousBodySelectionRef.current = null;
    };
  }, [marqueeDraft]);

  useEffect(() => {
    return () => {
      if (viewportTimer.current) {
        clearTimeout(viewportTimer.current);
      }
      if (previousBodySelectionRef.current) {
        document.body.style.userSelect = previousBodySelectionRef.current.userSelect;
        document.body.style.webkitUserSelect = previousBodySelectionRef.current.webkitUserSelect;
        previousBodySelectionRef.current = null;
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
      onViewportInteractionStart?.();

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
      const amplifiedScale = Math.pow(gestureScale, PINCH_ZOOM_EXPONENT);
      const nextZoom = clamp(gestureRef.current.startView.zoom * amplifiedScale, 0.35, 2.4);
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
  }, [onViewportInteractionStart, scheduleViewportCommit, viewport]);

  const onBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      onSelectConnection(null);
      if (interactionRef.current.type === "connect") {
        clearConnectionDraft();
      }

      if (event.shiftKey) {
        onViewportInteractionStart?.();
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        setDragDraftPositions(null);
        const point = toWorldPoint(event.clientX, event.clientY);
        interactionRef.current = {
          type: "marquee",
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        };
        setInteractionMode("marquee");
        setMarqueeDraft({
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        });
        return;
      }

      onSelectSingleNode(null);
      onViewportInteractionStart?.();
      setDragDraftPositions(null);
      interactionRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewRef.current,
      };
      setInteractionMode("pan");
    },
    [clearConnectionDraft, onSelectConnection, onSelectSingleNode, onViewportInteractionStart, toWorldPoint]
  );

  const onNodePointerDown = useCallback(
    (node: CanvasRenderNode, event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onViewportInteractionStart?.();

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        event.currentTarget.focus();
        onToggleNodeSelection(node.id);
        return;
      }

      const target = event.target as HTMLElement | null;
      const requiresDragHandle = node.presentation.useRailDragHandle;
      const hasDragHandle = Boolean(target?.closest("[data-node-drag-handle='true']"));
      if (requiresDragHandle && !hasDragHandle) {
        if (!(selectedNodeIds.length === 1 && selectedNodeIds[0] === node.id)) {
          onSelectSingleNode(node.id);
        }
        return;
      }

      event.currentTarget.focus();

      const point = toWorldPoint(event.clientX, event.clientY);
      const draggingSelectedGroup = selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1;
      const draggedNodeIds = draggingSelectedGroup ? selectedNodeIds : [node.id];
      const initialPositions = draggedNodeIds.reduce<Record<string, { x: number; y: number }>>((acc, nodeId) => {
        const currentNode = nodesById[nodeId];
        if (currentNode) {
          acc[nodeId] = {
            x: currentNode.x,
            y: currentNode.y,
          };
        }
        return acc;
      }, {});
      interactionRef.current = {
        type: "drag",
        nodeIds: draggedNodeIds,
        anchorNodeId: node.id,
        anchorStartX: node.x,
        anchorStartY: node.y,
        pointerOffsetX: point.x - node.x,
        pointerOffsetY: point.y - node.y,
        initialPositions,
      };
      setInteractionMode("drag");

      if (!draggingSelectedGroup) {
        onSelectSingleNode(node.id);
      }
    },
    [nodesById, onSelectSingleNode, onToggleNodeSelection, onViewportInteractionStart, selectedNodeIds, toWorldPoint]
  );

  const onResizeHandlePointerDown = useCallback(
    (node: CanvasRenderNode, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      onViewportInteractionStart?.();
      const startSize = getNodeSize(node.id);
      onSelectSingleNode(node.id);
      onStartNodeResize?.(node.id, startSize);
      interactionRef.current = {
        type: "resize",
        nodeId: node.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startSize,
        aspectRatio: node.lockAspectRatio ? startSize.width / Math.max(1, startSize.height) : null,
      };
      setInteractionMode("resize");
    },
    [getNodeSize, onSelectSingleNode, onStartNodeResize, onViewportInteractionStart]
  );

  const onPortPointerDown = useCallback(
    (node: CanvasRenderNode, port: "input" | "output", event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      onViewportInteractionStart?.();
      onSelectConnection(null);

      const source =
        port === "output"
          ? getOutputPortPoint(node, getNodeBoundsSize(node.id))
          : getInputPortPoint(node, getNodeBoundsSize(node.id));
      interactionRef.current = {
        type: "connect",
        nodeId: node.id,
        port,
      };
      setInteractionMode("connect");
      setConnectionDraft({
        nodeId: node.id,
        port,
        targetX: source.x,
        targetY: source.y,
      });
      onSelectSingleNode(node.id);
    },
    [getNodeBoundsSize, onSelectConnection, onSelectSingleNode, onViewportInteractionStart]
  );

  const onPortPointerUp = useCallback(
    (targetNodeId: string, targetPort: "input" | "output", event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();

      const interaction = interactionRef.current;
      if (interaction.type !== "connect") {
        return;
      }

      commitConnection(interaction.nodeId, interaction.port, targetNodeId, targetPort);
    },
    [commitConnection]
  );

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const point = toWorldPoint(event.clientX, event.clientY);
      onRequestInsertMenu({
        ...point,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [onRequestInsertMenu, toWorldPoint]
  );

  const draftPath = useMemo(() => {
    if (!connectionDraft) {
      return null;
    }

    const sourceNode = nodesById[connectionDraft.nodeId];
    if (!sourceNode) {
      return null;
    }

    const start =
      connectionDraft.port === "output"
        ? getOutputPortPoint(sourceNode, getNodeBoundsSize(sourceNode.id))
        : getInputPortPoint(sourceNode, getNodeBoundsSize(sourceNode.id));
    return curvePath(start.x, start.y, connectionDraft.targetX, connectionDraft.targetY);
  }, [connectionDraft, getNodeBoundsSize, nodesById]);

  const activeConnectionNodeIds = useMemo(() => {
    const ids = new Set<string>();

    if (connectionDraft?.nodeId) {
      ids.add(connectionDraft.nodeId);
    }

    if (!selectedConnectionId) {
      return ids;
    }

    const selectedEdge = edges.find((edge) => edge.id === selectedConnectionId);
    if (!selectedEdge) {
      return ids;
    }

    ids.add(selectedEdge.sourceNodeId);
    ids.add(selectedEdge.targetNodeId);
    return ids;
  }, [connectionDraft?.nodeId, edges, selectedConnectionId]);

  const phantomLayout = useMemo(() => {
    if (!activePhantomPreview) {
      return null;
    }

    const sourceNode = nodesById[activePhantomPreview.sourceNodeId];
    if (!sourceNode) {
      return null;
    }

    const sourceSize = getNodeBoundsSize(sourceNode.id);
    const startX = sourceNode.x + sourceSize.width + 84;
    const startY = sourceNode.y;
    const nodes = activePhantomPreview.nodes.map((phantomNode, index) => {
      const width = phantomNode.width || 184;
      const height = phantomNode.height || 108;
      return {
        ...phantomNode,
        x: startX + Math.floor(index / 3) * 32,
        y: startY + (index % 3) * (height + 18),
        width,
        height,
      };
    });

    return {
      sourceNode,
      sourceSize,
      nodes,
    };
  }, [activePhantomPreview, getNodeBoundsSize, nodesById]);

  return (
    <div
      ref={containerRef}
      data-testid="canvas-root"
      className={`${styles.canvasRoot} ${marqueeDraft ? styles.canvasMarqueeActive : ""} ${interactionMode !== "idle" ? styles.canvasInteractionActive : ""}`}
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
        className={`${styles.world} ${enableProgrammaticViewportMotion ? styles.worldAnimated : ""}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className={styles.connectionLayer} aria-hidden="true">
          {edges.map((edge) => (
            <g key={edge.id}>
              <path
                className={styles.connectionHit}
                d={curvePath(edge.start.x, edge.start.y, edge.end.x, edge.end.y)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onSelectSingleNode(null);
                  onSelectConnection({
                    id: edge.id,
                    kind: edge.kind,
                    sourceNodeId: edge.sourceNodeId,
                    targetNodeId: edge.targetNodeId,
                    semanticType: edge.semanticType,
                    lineStyle: edge.lineStyle,
                  });
                }}
              />
              {selectedConnectionId === edge.id ? (
                <path
                  className={styles.connectionSelectionHalo}
                  d={curvePath(edge.start.x, edge.start.y, edge.end.x, edge.end.y)}
                />
              ) : null}
              <path
                className={`${styles.connection} ${selectedConnectionId === edge.id ? styles.connectionSelected : ""} ${
                  edge.lineStyle === "dashed" ? styles.connectionDashed : ""
                }`}
                d={curvePath(edge.start.x, edge.start.y, edge.end.x, edge.end.y)}
                style={
                  {
                    "--edge-color": semanticColor(edge.semanticType),
                    "--edge-glow": semanticGlow(edge.semanticType),
                  } as CSSProperties
                }
              />
            </g>
          ))}
          {draftPath ? (
            <path
              className={styles.connectionDraft}
              d={draftPath}
              style={
                {
                  "--edge-color":
                    connectionDraft?.port === "output"
                      ? semanticColor(getNodeOutputAccentType(nodesById[connectionDraft.nodeId]))
                      : "#ffffff",
                } as CSSProperties
              }
            />
          ) : null}
          {phantomLayout
            ? phantomLayout.nodes.map((phantomNode) => (
                <path
                  key={`phantom-edge-${phantomNode.id}`}
                  className={styles.phantomConnection}
                  d={curvePath(
                    phantomLayout.sourceNode.x + phantomLayout.sourceSize.width,
                    phantomLayout.sourceNode.y + phantomLayout.sourceSize.height / 2,
                    phantomNode.x,
                    phantomNode.y + phantomNode.height / 2
                  )}
                />
              ))
            : null}
        </svg>

        {displayNodes.map((node) => {
          const isTextNote = node.kind === "text-note";
          const isListNode = node.kind === "list";
          const isTextTemplateNode = node.kind === "text-template";
          const isModelNode = node.kind === "model";
          const isOperatorNode = node.kind === "text-template";
          const isGeneratedAsset = isGeneratedAssetNode(node);
          const isGeneratedTextNote = isGeneratedTextNoteNode(node);
          const isUploadedAsset = node.kind === "asset-source" && node.assetOrigin === "uploaded";
          const imageSourceUrl =
            node.outputType === "image"
              ? node.sourceAssetId
                ? getAssetFileUrl(node.sourceAssetId)
                : node.previewImageUrl || null
              : null;
          const hasImageSource = Boolean(imageSourceUrl);
          const shouldRenderImageFrame = node.kind === "asset-source" && node.outputType === "image";
          const hasNonImageSource = Boolean(node.sourceAssetId && node.outputType !== "image");
          const isSelected = selectedNodeIds.includes(node.id);
          const showInputPort = !isListNode && (!isTextNote || isGeneratedTextNote);
          const showOutputPort =
            isListNode ||
            isTextNote ||
            isOperatorNode ||
            (node.kind === "asset-source" && !isModelNode) ||
            (isModelNode && node.outputType !== "text" && Boolean(node.hasStartedJob));
          const outputAccentType = getNodeOutputAccentType(node);
          const hasConnectedOutput = isModelNode || isOperatorNode
            ? edges.some((edge) => edge.sourceNodeId === node.id)
            : false;
          const borderSemantics = resolveCanvasNodeBorderSemantics({
            kind: node.kind,
            assetOrigin: node.assetOrigin,
            outputAccentType,
            inputAccentTypes: node.inputSemanticTypes,
            generatedProvenance: node.generatedProvenance,
            processingState: node.processingState,
            hasConnectedOutput,
          });
          const normalizedLeftAccentTypes =
            borderSemantics.leftAccentTypes.length > 0
              ? borderSemantics.leftAccentTypes
              : [borderSemantics.fallbackLeftAccentType];
          const showsProcessingShell = borderSemantics.shouldShowProcessingShimmer;
          const inputAccentGradient = getInputAccentGradient(normalizedLeftAccentTypes);
          const outputColor = semanticColor(borderSemantics.rightAccentType);
          const imageFrameAspectRatio = shouldRenderImageFrame
            ? getImageFrameAspectRatio(node, nodesById, imageAspectRatios)
            : 1;
          const generatedBorderGradient = getBorderGradient(normalizedLeftAccentTypes, borderSemantics.rightAccentType);
          const borderLayers = getCanvasNodeBorderLayers(
            borderSemantics.leftAccentTypes,
            borderSemantics.rightAccentType,
            borderSemantics.fallbackLeftAccentType
          );
          const selectionHaloColors = getSelectionHaloColors(
            normalizedLeftAccentTypes,
            borderSemantics.rightAccentType
          );
          const programmaticFrameSize = programmaticMotionFrameSizes[node.id];
          const autoHeight = usesContentHeight(node) && !programmaticFrameSize;
          const nodeStyle: CSSProperties = {
            left: `${node.x}px`,
            top: `${node.y}px`,
            zIndex: node.zIndex,
            width: `${getNodeSize(node.id).width}px`,
            height: autoHeight ? undefined : `${getNodeSize(node.id).height}px`,
            "--node-output-accent": outputColor,
            "--node-border-gradient": generatedBorderGradient,
            "--model-border-top": borderLayers.top,
            "--model-border-right": borderLayers.right,
            "--model-border-bottom": borderLayers.bottom,
            "--model-border-left": borderLayers.left,
            "--text-note-border-top": borderLayers.top,
            "--text-note-border-right": borderLayers.right,
            "--text-note-border-bottom": borderLayers.bottom,
            "--text-note-border-left": borderLayers.left,
            "--node-frame-border-top": borderLayers.top,
            "--node-frame-border-right": borderLayers.right,
            "--node-frame-border-bottom": borderLayers.bottom,
            "--node-frame-border-left": borderLayers.left,
            "--node-glow-left-top": selectionHaloColors.leftTop,
            "--node-glow-left-bottom": selectionHaloColors.leftBottom,
            "--node-glow-right": selectionHaloColors.right,
            "--node-right-accent": semanticColor(borderSemantics.rightAccentType),
          } as CSSProperties;
          const inputPortStyle = {
            "--port-fill": inputAccentGradient,
            "--port-glow":
              normalizedLeftAccentTypes.length > 0
                ? semanticGlow(normalizedLeftAccentTypes[0])
                : "color-mix(in srgb, var(--node-accent-neutral) 38%, transparent)",
          } as CSSProperties;
          const outputPortStyle = {
            "--port-fill": outputColor,
            "--port-glow": semanticGlow(borderSemantics.rightAccentType),
          } as CSSProperties;

          return (
            <div
              key={node.id}
              ref={(element) => {
                nodeElementRefs.current[node.id] = element;
              }}
              role="button"
              tabIndex={0}
              data-node-id={node.id}
              data-rail-drag={node.presentation.useRailDragHandle ? "true" : "false"}
              className={`${styles.node} ${isSelected ? styles.nodeSelected : ""} ${programmaticMotionNodeIdSet.has(node.id) ? styles.nodeProgrammaticMotion : ""} ${shouldRenderImageFrame ? nodeStyles.nodeWithImage : ""} ${isGeneratedAsset ? nodeStyles.nodeGeneratedAsset : ""} ${isUploadedAsset ? nodeStyles.nodeUploadedAsset : ""} ${isTextNote ? nodeStyles.nodeTextNote : ""} ${isTextNote && !isGeneratedTextNote ? nodeStyles.nodeSemanticFrame : ""} ${isGeneratedTextNote ? nodeStyles.nodeGeneratedTextNote : ""} ${isListNode ? nodeStyles.nodeList : ""} ${isListNode ? nodeStyles.nodeSemanticFrame : ""} ${isTextTemplateNode ? nodeStyles.nodeTextTemplate : ""} ${isModelNode || isOperatorNode ? nodeStyles.nodeModel : ""} ${activeConnectionNodeIds.has(node.id) ? styles.nodePortActive : ""} ${showsProcessingShell ? nodeStyles.nodeGeneratedProcessing : ""} ${node.renderMode === "compact" ? nodeStyles.nodeCompactMode : ""} ${node.renderMode === "full" ? nodeStyles.nodeFullMode : ""} ${node.renderMode === "resized" ? nodeStyles.nodeResizedMode : ""}`}
              style={nodeStyle}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onNodeDoubleClick(node.id);
              }}
              onPointerDown={(event) => onNodePointerDown(node, event)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || isEditableElement(event.target)) {
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  onNodeActivate(node.id);
                  return;
                }
                if (event.key === " ") {
                  event.preventDefault();
                  onSelectSingleNode(node.id);
                }
              }}
            >
              {showInputPort ? (
                <button
                  type="button"
                  className={`${styles.port} ${styles.inputPort}`}
                  style={inputPortStyle}
                  onPointerDown={(event) => onPortPointerDown(node, "input", event)}
                  onPointerUp={(event) => onPortPointerUp(node.id, "input", event)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Connect input to ${node.label}`}
                />
              ) : null}

              {showOutputPort ? (
                <button
                  type="button"
                  className={`${styles.port} ${styles.outputPort}`}
                  style={outputPortStyle}
                  onPointerDown={(event) => onPortPointerDown(node, "output", event)}
                  onPointerUp={(event) => onPortPointerUp(node.id, "output", event)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Start output connection from ${node.label}`}
                />
              ) : null}

              {shouldRenderImageFrame ? (
                <div className={nodeStyles.assetNodeLayout}>
                  <div
                    className={`${nodeStyles.sourcePreviewFrame} ${isGeneratedAsset ? nodeStyles.sourcePreviewFrameGenerated : ""} ${isUploadedAsset ? nodeStyles.sourcePreviewFrameUploaded : ""} ${showsProcessingShell ? nodeStyles.sourcePreviewFrameProcessing : ""} ${
                      !hasImageSource ? nodeStyles.sourcePreviewFramePlaceholder : ""
                    }`}
                    style={{
                      aspectRatio: String(imageFrameAspectRatio),
                    }}
                  >
                    {hasImageSource ? (
                      <img
                        className={nodeStyles.sourcePreviewImage}
                        src={imageSourceUrl || undefined}
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
                    ) : (
                      <div className={nodeStyles.imagePlaceholderSurface} />
                    )}
                  </div>
                  {renderNodeContent(node)}
                </div>
              ) : (
                renderNodeContent(node)
              )}

              {hasNonImageSource ? (
                <div className={nodeStyles.sourceBadge}>{`${node.outputType.toUpperCase()} source`}</div>
              ) : null}
              {node.presentation.showResizeHandle ? (
                <button
                  type="button"
                  className={`${nodeStyles.resizeHandle} ${nodeStyles.resizeHandleVisible}`}
                  onPointerDown={(event) => onResizeHandlePointerDown(node, event)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Resize ${node.label}`}
                />
              ) : null}
            </div>
          );
        })}

        {phantomLayout
          ? phantomLayout.nodes.map((phantomNode, index) => (
              <div
                key={phantomNode.id}
                className={styles.phantomNode}
                data-kind={phantomNode.kind}
                style={{
                  left: `${phantomNode.x}px`,
                  top: `${phantomNode.y}px`,
                  width: `${phantomNode.width}px`,
                  height: `${phantomNode.height}px`,
                  aspectRatio: phantomNode.aspectRatio ? String(phantomNode.aspectRatio) : undefined,
                }}
              >
                <strong>{phantomNode.label}</strong>
                {index === phantomLayout.nodes.length - 1 && activePhantomPreview && activePhantomPreview.overflowCount > 0 ? (
                  <span>{`+${activePhantomPreview.overflowCount}`}</span>
                ) : null}
              </div>
            ))
          : null}

        {phantomLayout && onRunActiveNode ? (
          <button
            type="button"
            className={styles.edgeRunButton}
            style={{
              left: `${phantomLayout.sourceNode.x + phantomLayout.sourceSize.width + 18}px`,
              top: `${phantomLayout.sourceNode.y + phantomLayout.sourceSize.height / 2 - 16}px`,
            }}
            disabled={Boolean(activePhantomPreview?.runDisabledReason)}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onRunActiveNode(phantomLayout.sourceNode.id);
            }}
            title={activePhantomPreview?.runDisabledReason || "Run"}
          >
            Run
          </button>
        ) : null}

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
