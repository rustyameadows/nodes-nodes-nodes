"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CanvasRenderNode } from "@/components/canvas-node-types";
import type { WorkflowNodeSize } from "@/components/workspace/types";
import { shouldCanvasNodeMeasureContentHeight } from "@/lib/canvas-node-presentation";
import styles from "@/components/infinite-canvas.module.css";
import nodeStyles from "@/components/canvas-nodes/canvas-node.module.css";

type CanvasFocusPreflightRequest = {
  id: number;
  node: CanvasRenderNode;
};

function isGeneratedTextNoteNode(node: CanvasRenderNode) {
  return (
    node.kind === "text-note" &&
    (node.settings.source === "generated-model-text" || node.settings.source === "template-output")
  );
}

function isGeneratedAssetNode(node: CanvasRenderNode) {
  return node.kind === "asset-source" && node.assetOrigin === "generated";
}

function getPreflightNodeClassName(node: CanvasRenderNode) {
  const classes = [styles.node];
  const isTextNote = node.kind === "text-note";
  const isListNode = node.kind === "list";
  const isTextTemplateNode = node.kind === "text-template";
  const isModelNode = node.kind === "model";
  const isOperatorNode = node.kind === "text-template";
  const isGeneratedAsset = isGeneratedAssetNode(node);
  const isGeneratedTextNote = isGeneratedTextNoteNode(node);
  const isUploadedAsset = node.kind === "asset-source" && node.assetOrigin === "uploaded";
  const shouldRenderImageFrame = node.kind === "asset-source" && node.outputType === "image";

  if (shouldRenderImageFrame) {
    classes.push(nodeStyles.nodeWithImage);
  }
  if (isGeneratedAsset) {
    classes.push(nodeStyles.nodeGeneratedAsset);
  }
  if (isUploadedAsset) {
    classes.push(nodeStyles.nodeUploadedAsset);
  }
  if (isTextNote) {
    classes.push(nodeStyles.nodeTextNote);
  }
  if (isTextNote && !isGeneratedTextNote) {
    classes.push(nodeStyles.nodeSemanticFrame);
  }
  if (isGeneratedTextNote) {
    classes.push(nodeStyles.nodeGeneratedTextNote);
  }
  if (isListNode) {
    classes.push(nodeStyles.nodeList, nodeStyles.nodeSemanticFrame);
  }
  if (isTextTemplateNode) {
    classes.push(nodeStyles.nodeTextTemplate);
  }
  if (isModelNode || isOperatorNode) {
    classes.push(nodeStyles.nodeModel);
  }
  if (node.renderMode === "compact") {
    classes.push(nodeStyles.nodeCompactMode);
  }
  if (node.renderMode === "full") {
    classes.push(nodeStyles.nodeFullMode);
  }
  if (node.renderMode === "resized") {
    classes.push(nodeStyles.nodeResizedMode);
  }

  return classes.join(" ");
}

function getPreflightNodeStyle(node: CanvasRenderNode): CSSProperties {
  const autoHeight = shouldCanvasNodeMeasureContentHeight({
    kind: node.kind,
    renderMode: node.renderMode,
  });

  return {
    left: 0,
    top: 0,
    width: `${node.resolvedSize.width}px`,
    height: autoHeight ? undefined : `${node.resolvedSize.height}px`,
    zIndex: 1,
    transition: "none",
  };
}

export function useCanvasFocusPreflightMeasurement() {
  const requestIdRef = useRef(0);
  const resolverRef = useRef<{
    id: number;
    resolve: (size: WorkflowNodeSize | null) => void;
  } | null>(null);
  const [request, setRequest] = useState<CanvasFocusPreflightRequest | null>(null);

  useEffect(() => {
    return () => {
      resolverRef.current?.resolve(null);
      resolverRef.current = null;
    };
  }, []);

  const measureNode = useCallback((node: CanvasRenderNode | null) => {
    if (!node) {
      return Promise.resolve<WorkflowNodeSize | null>(null);
    }

    if (
      !shouldCanvasNodeMeasureContentHeight({
        kind: node.kind,
        renderMode: node.renderMode,
      })
    ) {
      return Promise.resolve<WorkflowNodeSize | null>(node.resolvedSize);
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    resolverRef.current?.resolve(null);

    return new Promise<WorkflowNodeSize | null>((resolve) => {
      resolverRef.current = {
        id: requestId,
        resolve,
      };
      setRequest({
        id: requestId,
        node,
      });
    });
  }, []);

  const resolveMeasurement = useCallback((requestId: number, size: WorkflowNodeSize | null) => {
    if (resolverRef.current?.id !== requestId) {
      return;
    }

    const resolver = resolverRef.current;
    resolverRef.current = null;
    resolver.resolve(size);
    setRequest((current) => (current?.id === requestId ? null : current));
  }, []);

  return {
    request,
    measureNode,
    resolveMeasurement,
  };
}

export function CanvasFocusPreflightLayer({
  request,
  renderNodeContent,
  onMeasured,
}: {
  request: CanvasFocusPreflightRequest | null;
  renderNodeContent: (node: CanvasRenderNode) => ReactNode;
  onMeasured: (requestId: number, size: WorkflowNodeSize | null) => void;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!request) {
      return;
    }

    let cancelled = false;
    let frameId = 0;
    const element = nodeRef.current;
    if (!element) {
      return;
    }

    const emitSize = () => {
      if (cancelled) {
        return;
      }

      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      if (width <= 0 || height <= 0) {
        return;
      }

      onMeasured(request.id, { width, height });
    };

    const observer = new ResizeObserver(() => {
      emitSize();
    });
    observer.observe(element);
    frameId = window.requestAnimationFrame(() => {
      emitSize();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [onMeasured, request]);

  if (!request) {
    return null;
  }

  return (
    <div className={`${styles.preflightLayer} ${styles.canvasRoot}`} aria-hidden="true">
      <div className={styles.preflightNodeHost}>
        <div
          ref={nodeRef}
          className={getPreflightNodeClassName(request.node)}
          style={getPreflightNodeStyle(request.node)}
        >
          {renderNodeContent(request.node)}
        </div>
      </div>
    </div>
  );
}
