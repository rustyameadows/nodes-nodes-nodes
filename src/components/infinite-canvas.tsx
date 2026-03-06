"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isRunnableOpenAiImageModel, parseImageSize } from "@/lib/openai-image-settings";
import styles from "./infinite-canvas.module.css";

type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

type CanvasNode = {
  id: string;
  label: string;
  kind: "model" | "asset-source" | "text-note";
  providerId: "openai" | "google-gemini" | "topaz";
  modelId: string;
  nodeType: "text-gen" | "image-gen" | "video-gen" | "transform" | "text-note";
  outputType: "image" | "video" | "text";
  prompt: string;
  settings: Record<string, unknown>;
  sourceAssetId: string | null;
  sourceAssetMimeType: string | null;
  sourceJobId: string | null;
  sourceOutputIndex: number | null;
  processingState: "queued" | "running" | "failed" | null;
  promptSourceNodeId: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  assetOrigin?: "generated" | "uploaded" | null;
  sourceModelNodeId?: string | null;
  displayModelName?: string | null;
  displaySourceLabel?: string | null;
  inputSemanticTypes?: Array<"text" | "image" | "video">;
  outputSemanticType?: "text" | "image" | "video";
  previewImageUrl?: string | null;
  hasStartedJob?: boolean;
  x: number;
  y: number;
};

export type CanvasInsertRequest = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  connectionNodeId?: string;
  connectionPort?: "input" | "output";
};

type CanvasAccentType = "text" | "image" | "video" | "citrus" | "neutral";

export type CanvasConnection = {
  id: string;
  kind: "input" | "prompt";
  sourceNodeId: string;
  targetNodeId: string;
  semanticType: CanvasAccentType;
  lineStyle: "solid" | "dashed";
};

type Props = {
  nodes: CanvasNode[];
  selectedNodeIds: string[];
  selectedConnectionId: string | null;
  viewport: CanvasViewport;
  onSelectSingleNode: (nodeId: string | null) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onMarqueeSelectNodes: (nodeIds: string[]) => void;
  onUpdateTextNote: (nodeId: string, prompt: string) => void;
  onRequestInsertMenu: (request: CanvasInsertRequest) => void;
  onDropFiles: (files: File[], position: { x: number; y: number }) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onSelectConnection: (connection: CanvasConnection | null) => void;
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
      nodeId: string;
      port: "input" | "output";
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
const IMAGE_NODE_LONG_EDGE = 260;
const LINE_DELTA_PX = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.00125;
const GESTURE_ZOOM_SENSITIVITY = 0.00165;
const PINCH_ZOOM_EXPONENT = 1.18;
const SEMANTIC_TYPE_ORDER = ["text", "image", "video"] as const;
const CITRUS_COLOR = "#d8ff3e";
const CITRUS_GLOW = "rgba(216, 255, 62, 0.52)";

function semanticColor(type: CanvasAccentType) {
  if (type === "citrus") {
    return CITRUS_COLOR;
  }
  if (type === "neutral") {
    return "rgba(255, 255, 255, 0.9)";
  }
  if (type === "text") {
    return "#ff4dc4";
  }
  if (type === "video") {
    return "#ff8d34";
  }
  return "#3ea4ff";
}

function semanticGlow(type: CanvasAccentType) {
  if (type === "citrus") {
    return CITRUS_GLOW;
  }
  if (type === "neutral") {
    return "rgba(255, 255, 255, 0.26)";
  }
  if (type === "text") {
    return "rgba(255, 77, 196, 0.5)";
  }
  if (type === "video") {
    return "rgba(255, 141, 52, 0.46)";
  }
  return "rgba(62, 164, 255, 0.48)";
}

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

function getNodeOutputSemanticType(node: CanvasNode) {
  return node.outputSemanticType || node.outputType;
}

function getNodeOutputAccentType(node: CanvasNode): CanvasAccentType {
  if (node.kind === "model") {
    return "citrus";
  }
  return getNodeOutputSemanticType(node);
}

function hasCustomModelTitle(label: string) {
  return !/^Node \d+( Copy)?$/.test(label.trim());
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

function isGeneratedAssetNode(node: CanvasNode) {
  return node.kind === "asset-source" && node.assetOrigin === "generated";
}

function getImageFrameAspectRatio(
  node: CanvasNode,
  nodesById: Record<string, CanvasNode>,
  imageAspectRatios: Record<string, number>
) {
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

  return 1;
}

function getImageNodeDisplaySize(aspectRatio: number) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

  if (safeAspectRatio >= 1) {
    return {
      width: IMAGE_NODE_LONG_EDGE,
      height: Math.round(IMAGE_NODE_LONG_EDGE / safeAspectRatio),
    };
  }

  return {
    width: Math.round(IMAGE_NODE_LONG_EDGE * safeAspectRatio),
    height: IMAGE_NODE_LONG_EDGE,
  };
}

function getInputAccentGradient(inputSemanticTypes: Array<"text" | "image" | "video"> | undefined) {
  const filteredTypes = SEMANTIC_TYPE_ORDER.filter((type) => inputSemanticTypes?.includes(type));
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

function mixColor(colorA: string, colorB: string, ratioA = 50) {
  const ratioB = 100 - ratioA;
  return `color-mix(in srgb, ${colorA} ${ratioA}%, ${colorB} ${ratioB}%)`;
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

function getModelBorderLayers(leftAccentTypes: CanvasAccentType[], rightAccentType: CanvasAccentType) {
  const uniqueLeftTypes = leftAccentTypes.filter((type, index) => leftAccentTypes.indexOf(type) === index);
  const normalizedLeftTypes: CanvasAccentType[] = uniqueLeftTypes.length > 0 ? uniqueLeftTypes : ["neutral"];
  const topLeft = semanticColor(normalizedLeftTypes[0]);
  const bottomLeft = semanticColor(normalizedLeftTypes[Math.min(1, normalizedLeftTypes.length - 1)]);
  const right = semanticColor(rightAccentType);
  const neutral = semanticColor("neutral");
  const rightSide = rightAccentType === "neutral" ? neutral : right;

  if (normalizedLeftTypes.length > 1) {
    return {
      top: `linear-gradient(90deg, ${topLeft} 0%, ${topLeft} 42%, ${mixColor(topLeft, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
      bottom: `linear-gradient(90deg, ${bottomLeft} 0%, ${bottomLeft} 42%, ${mixColor(bottomLeft, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
      left: `linear-gradient(180deg, ${topLeft} 0%, ${topLeft} 42%, ${mixColor(topLeft, bottomLeft, 52)} 50%, ${bottomLeft} 58%, ${bottomLeft} 100%)`,
      right: `linear-gradient(180deg, ${rightSide} 0%, ${rightSide} 100%)`,
    };
  }

  const left = topLeft;
  return {
    top: `linear-gradient(90deg, ${left} 0%, ${left} 42%, ${mixColor(left, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
    bottom: `linear-gradient(90deg, ${left} 0%, ${left} 42%, ${mixColor(left, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
    left: `linear-gradient(180deg, ${left} 0%, ${left} 100%)`,
    right: `linear-gradient(180deg, ${rightSide} 0%, ${rightSide} 100%)`,
  };
}

function getSelectionHaloColors(
  leftAccentTypes: CanvasAccentType[],
  rightAccentType: CanvasAccentType,
  kind: CanvasNode["kind"],
  assetOrigin?: CanvasNode["assetOrigin"]
) {
  if (kind === "text-note") {
    const color = semanticColor("text");
    return {
      leftTop: color,
      leftBottom: color,
      right: color,
    };
  }

  if (kind === "asset-source" && assetOrigin === "uploaded") {
    const color = semanticColor("image");
    return {
      leftTop: color,
      leftBottom: color,
      right: color,
    };
  }

  if (kind === "asset-source" && assetOrigin === "generated") {
    return {
      leftTop: semanticColor("citrus"),
      leftBottom: semanticColor("citrus"),
      right: semanticColor(rightAccentType),
    };
  }

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
  onUpdateTextNote,
  onRequestInsertMenu,
  onDropFiles,
  onViewportChange,
  onNodePositionChange,
  onConnectNodes,
  onSelectConnection,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [view, setView] = useState<CanvasViewport>(viewport);
  const [nodeSizes, setNodeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
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
  }, [nodes, selectedNodeIds]);

  const edges = useMemo(() => {
    return nodes.flatMap((targetNode) => {
      const connections: CanvasConnection[] = [
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
          const sourceNode = nodesById[connection.sourceNodeId];
          if (!sourceNode) {
            return null;
          }

          const semanticType =
            connection.kind === "prompt"
              ? ("text" as const)
              : sourceNode.kind === "model" && isGeneratedAssetNode(targetNode)
                ? ("citrus" as const)
                : getNodeOutputSemanticType(sourceNode);
          const lineStyle =
            connection.kind === "input" &&
            isGeneratedAssetNode(targetNode) &&
            (targetNode.processingState === "queued" || targetNode.processingState === "running")
              ? ("dashed" as const)
              : ("solid" as const);

          const start = getOutputPortPoint(sourceNode, getNodeSize(sourceNode.id));
          const end = getInputPortPoint(targetNode, getNodeSize(targetNode.id));

          return {
            ...connection,
            semanticType,
            lineStyle,
            start,
            end,
          };
        })
        .filter(
          (
            edge
          ): edge is NonNullable<typeof edge> => Boolean(edge)
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

  const clearConnectionDraft = useCallback(() => {
    interactionRef.current = { type: "idle" };
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
    [onNodePositionChange, scheduleViewportCommit, toWorldPoint]
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
  }, [clearConnectionDraft, getNodeSize, isCanvasBackgroundTarget, nodes, onMarqueeSelectNodes, onRequestInsertMenu, toWorldPoint]);

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
  }, [scheduleViewportCommit, viewport]);

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
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
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
    [clearConnectionDraft, onSelectConnection, onSelectSingleNode, toWorldPoint]
  );

  const onNodePointerDown = useCallback(
    (node: CanvasNode, event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onSelectConnection(null);

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
    [onSelectConnection, onSelectSingleNode, onToggleNodeSelection, toWorldPoint]
  );

  const onPortPointerDown = useCallback(
    (node: CanvasNode, port: "input" | "output", event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      onSelectConnection(null);

      const source =
        port === "output" ? getOutputPortPoint(node, getNodeSize(node.id)) : getInputPortPoint(node, getNodeSize(node.id));
      interactionRef.current = {
        type: "connect",
        nodeId: node.id,
        port,
      };
      setConnectionDraft({
        nodeId: node.id,
        port,
        targetX: source.x,
        targetY: source.y,
      });
      onSelectSingleNode(node.id);
    },
    [getNodeSize, onSelectConnection, onSelectSingleNode]
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
        ? getOutputPortPoint(sourceNode, getNodeSize(sourceNode.id))
        : getInputPortPoint(sourceNode, getNodeSize(sourceNode.id));
    return curvePath(start.x, start.y, connectionDraft.targetX, connectionDraft.targetY);
  }, [connectionDraft, getNodeSize, nodesById]);

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

  return (
    <div
      ref={containerRef}
      className={`${styles.canvasRoot} ${marqueeDraft ? styles.canvasMarqueeActive : ""}`}
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
        </svg>

        {nodes.map((node) => {
          const isTextNote = node.kind === "text-note";
          const isModelNode = node.kind === "model";
          const isGeneratedAsset = isGeneratedAssetNode(node);
          const isUploadedAsset = node.kind === "asset-source" && node.assetOrigin === "uploaded";
          const imageSourceUrl =
            node.outputType === "image"
              ? node.sourceAssetId
                ? `/api/assets/${node.sourceAssetId}/file`
                : node.previewImageUrl || null
              : null;
          const hasImageSource = Boolean(imageSourceUrl);
          const shouldRenderImageFrame = node.kind === "asset-source" && node.outputType === "image";
          const hasNonImageSource = Boolean(node.sourceAssetId && node.outputType !== "image");
          const isSelected = selectedNodeIds.includes(node.id);
          const showInputPort = !isTextNote;
          const showOutputPort = !isModelNode || Boolean(node.hasStartedJob);
          const showProcessingState = Boolean(node.processingState);
          const showsProcessingShell = isGeneratedAsset && (node.processingState === "queued" || node.processingState === "running");
          const inputAccentGradient = getInputAccentGradient(node.inputSemanticTypes);
          const semanticOutputType = getNodeOutputSemanticType(node);
          const outputAccentType = getNodeOutputAccentType(node);
          const outputColor = semanticColor(outputAccentType);
          const hasConnectedOutput = isModelNode
            ? edges.some((edge) => edge.sourceNodeId === node.id)
            : false;
          const modelRightAccentType: CanvasAccentType = hasConnectedOutput ? "citrus" : "neutral";
          const imageFrameAspectRatio = shouldRenderImageFrame
            ? getImageFrameAspectRatio(node, nodesById, imageAspectRatios)
            : 1;
          const imageNodeDisplaySize = shouldRenderImageFrame ? getImageNodeDisplaySize(imageFrameAspectRatio) : null;
          const generatedBorderGradient = getBorderGradient(["citrus"], semanticOutputType);
          const modelBorderLayers = getModelBorderLayers(
            (node.inputSemanticTypes && node.inputSemanticTypes.length > 0
              ? node.inputSemanticTypes
              : ["neutral"]) as CanvasAccentType[],
            modelRightAccentType
          );
          const selectionHaloColors = getSelectionHaloColors(
            (node.inputSemanticTypes && node.inputSemanticTypes.length > 0
              ? (node.inputSemanticTypes as CanvasAccentType[])
              : ["neutral"]),
            isModelNode ? modelRightAccentType : outputAccentType,
            node.kind,
            node.assetOrigin
          );
          const showsCustomModelTitle = isModelNode && hasCustomModelTitle(node.label);
          const displayFooterLabel =
            node.displaySourceLabel ||
            (isGeneratedAsset ? node.displayModelName || node.modelId : node.displayModelName || node.providerId);
          const nodeStyle: CSSProperties = {
            left: `${node.x}px`,
            top: `${node.y}px`,
            "--node-output-accent": outputColor,
            "--node-border-gradient": generatedBorderGradient,
            "--model-border-top": modelBorderLayers.top,
            "--model-border-right": modelBorderLayers.right,
            "--model-border-bottom": modelBorderLayers.bottom,
            "--model-border-left": modelBorderLayers.left,
            "--node-glow-left-top": selectionHaloColors.leftTop,
            "--node-glow-left-bottom": selectionHaloColors.leftBottom,
            "--node-glow-right": selectionHaloColors.right,
            "--node-right-accent": semanticColor(isModelNode ? modelRightAccentType : outputAccentType),
            ...(imageNodeDisplaySize
              ? {
                  width: `${imageNodeDisplaySize.width}px`,
                  height: `${imageNodeDisplaySize.height}px`,
                }
              : {}),
          } as CSSProperties;
          const inputPortStyle = {
            "--port-fill": inputAccentGradient,
            "--port-glow":
              node.inputSemanticTypes && node.inputSemanticTypes.length > 0
                ? semanticGlow(node.inputSemanticTypes[0])
                : "rgba(255, 255, 255, 0.34)",
          } as CSSProperties;
          const outputPortStyle = {
            "--port-fill": outputColor,
            "--port-glow": semanticGlow(outputAccentType),
          } as CSSProperties;

          return (
            <div
              key={node.id}
              ref={(element) => {
                nodeElementRefs.current[node.id] = element;
              }}
              role="button"
              tabIndex={0}
              className={`${styles.node} ${isSelected ? styles.nodeSelected : ""} ${shouldRenderImageFrame ? styles.nodeWithImage : ""} ${isGeneratedAsset ? styles.nodeGeneratedAsset : ""} ${isUploadedAsset ? styles.nodeUploadedAsset : ""} ${isTextNote ? styles.nodeTextNote : ""} ${isModelNode ? styles.nodeModel : ""} ${activeConnectionNodeIds.has(node.id) ? styles.nodePortActive : ""} ${showsProcessingShell ? styles.nodeGeneratedProcessing : ""}`}
              style={nodeStyle}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => onNodePointerDown(node, event)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || isEditableElement(event.target)) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
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
                <div
                  className={`${styles.sourcePreviewFrame} ${isGeneratedAsset ? styles.sourcePreviewFrameGenerated : ""} ${isUploadedAsset ? styles.sourcePreviewFrameUploaded : ""} ${showsProcessingShell ? styles.sourcePreviewFrameProcessing : ""} ${
                    !hasImageSource ? styles.sourcePreviewFramePlaceholder : ""
                  }`}
                  style={{
                    aspectRatio: String(imageFrameAspectRatio),
                  }}
                >
                  {hasImageSource ? (
                    <img
                      className={styles.sourcePreviewImage}
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
                    <div className={styles.imagePlaceholderSurface} />
                  )}
                  {showProcessingState ? (
                    <div className={styles.imageNodeStatus}>
                      <span className={styles.statusBubble} data-state={node.processingState || undefined}>
                        {node.processingState}
                      </span>
                    </div>
                  ) : null}
                  <div className={styles.imageNodeFooter}>
                    <span>{displayFooterLabel}</span>
                    <span>{node.outputType}</span>
                  </div>
                </div>
              ) : isTextNote ? (
                <>
                  {isSelected ? (
                    <textarea
                      className={styles.textNoteEditor}
                      value={node.prompt}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                      }}
                      onChange={(event) => onUpdateTextNote(node.id, event.target.value)}
                      placeholder="Write prompt notes here"
                    />
                  ) : (
                    <div className={styles.textNotePreview}>
                      {node.prompt.trim() || "Empty note"}
                    </div>
                  )}
                </>
              ) : (
                isModelNode ? (
                  <div
                    className={`${styles.modelPill} ${
                      showsCustomModelTitle ? styles.modelPillWithTitle : styles.modelPillSolo
                    }`}
                  >
                    {showsCustomModelTitle ? (
                      <div className={styles.modelPillTitle}>{node.label}</div>
                    ) : null}
                    <div className={styles.modelPillName}>{node.displayModelName || node.modelId}</div>
                  </div>
                ) : (
                  <>
                    <div className={styles.nodeTitle}>
                      <span>{node.label}</span>
                      {showProcessingState ? (
                        <span className={styles.statusBubble} data-state={node.processingState || undefined}>
                          {node.processingState}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.nodeBody}>
                      <span>{node.displayModelName || node.modelId}</span>
                      <span>{node.outputType}</span>
                    </div>
                  </>
                )
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
