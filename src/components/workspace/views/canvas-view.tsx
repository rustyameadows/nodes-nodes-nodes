"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { InfiniteCanvas } from "@/components/infinite-canvas";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  createJob,
  getCanvasWorkspace,
  getJobs,
  getProviders,
  normalizeNode,
  openProject,
  putCanvasWorkspace,
  uid,
  uploadProjectAsset,
} from "@/components/workspace/client-api";
import {
  defaultCanvasDocument,
  type Asset,
  type CanvasDocument,
  type Job,
  type ProviderModel,
  type WorkflowNode,
} from "@/components/workspace/types";
import styles from "./canvas-view.module.css";

const defaultNodeModalPosition = {
  x: 24,
  y: 92,
};

const supportedOutputOrder = ["image", "video", "text"] as const;

type Props = {
  projectId: string;
};

function capabilityEnabled(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function getModelSupportedOutputs(model: ProviderModel | undefined): WorkflowNode["outputType"][] {
  const capabilities = (model?.capabilities || {}) as Record<string, unknown>;
  const outputs = supportedOutputOrder.filter((outputType) => capabilityEnabled(capabilities[outputType]));
  return outputs.length > 0 ? [...outputs] : ["image", "video", "text"];
}

function resolveOutputType(
  currentOutputType: WorkflowNode["outputType"] | undefined,
  supportedOutputs: WorkflowNode["outputType"][]
): WorkflowNode["outputType"] {
  if (currentOutputType && supportedOutputs.includes(currentOutputType)) {
    return currentOutputType;
  }
  return supportedOutputs[0];
}

function nodeTypeFromOutput(outputType: WorkflowNode["outputType"]): WorkflowNode["nodeType"] {
  if (outputType === "text") {
    return "text-gen";
  }
  if (outputType === "video") {
    return "video-gen";
  }
  return "image-gen";
}

function outputTypeFromAssetType(type: Asset["type"]): WorkflowNode["outputType"] {
  if (type === "video") {
    return "video";
  }
  if (type === "text") {
    return "text";
  }
  return "image";
}

function buildAssetRefsFromNodes(upstreamNodeIds: string[], nodes: WorkflowNode[]) {
  const nodeMap = nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});

  const refs = upstreamNodeIds
    .map((nodeId) => {
      const sourceNode = nodeMap[nodeId];
      if (!sourceNode) {
        return null;
      }
      return sourceNode.sourceAssetId || `node:${nodeId}`;
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(refs)];
}

function fallbackProviderModel(providers: ProviderModel[]) {
  const first = providers[0];
  if (first) {
    return first;
  }

  return {
    providerId: "google-gemini" as const,
    modelId: "gemini-3.1-flash",
    displayName: "Nano Banana 2",
    capabilities: { text: true, image: true, video: true },
  };
}

function normalizeAssetNodeLabel(fileName: string, index: number) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return `Asset ${index + 1}`;
  }
  return trimmed.length <= 28 ? trimmed : `${trimmed.slice(0, 26)}...`;
}

function isInputLikeElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function CanvasView({ projectId }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderModel[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>(defaultCanvasDocument);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalPosition, setModalPosition] = useState(defaultNodeModalPosition);
  const [isUploading, setIsUploading] = useState(false);
  const [isApiPreviewOpen, setIsApiPreviewOpen] = useState(false);

  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const nodeModalRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const modalDragStateRef = useRef<{
    active: boolean;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  }>({
    active: false,
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
  });

  const groupedProviders = useMemo(() => {
    return providers.reduce<Record<string, ProviderModel[]>>((acc, model) => {
      acc[model.providerId] = acc[model.providerId] || [];
      acc[model.providerId].push(model);
      return acc;
    }, {});
  }, [providers]);

  const selectedNodes = useMemo(() => {
    const nodeMap = canvasDoc.workflow.nodes.reduce<Record<string, WorkflowNode>>((acc, node) => {
      acc[node.id] = node;
      return acc;
    }, {});

    return selectedNodeIds
      .map((nodeId) => nodeMap[nodeId])
      .filter((node): node is WorkflowNode => Boolean(node));
  }, [canvasDoc.workflow.nodes, selectedNodeIds]);

  const primarySelectedNodeId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;

  const selectedNode = useMemo(
    () => canvasDoc.workflow.nodes.find((node) => node.id === primarySelectedNodeId) || null,
    [canvasDoc.workflow.nodes, primarySelectedNodeId]
  );

  const selectedNodeIsAssetSource = Boolean(selectedNode?.sourceAssetId);

  const selectedModel = useMemo(() => {
    if (!selectedNode || selectedNodeIsAssetSource) {
      return undefined;
    }
    return providers.find(
      (model) => model.providerId === selectedNode.providerId && model.modelId === selectedNode.modelId
    );
  }, [providers, selectedNode, selectedNodeIsAssetSource]);

  const selectedNodeSupportedOutputs = useMemo(() => {
    if (selectedNode && selectedNodeIsAssetSource) {
      return [selectedNode.outputType];
    }
    return getModelSupportedOutputs(selectedModel);
  }, [selectedModel, selectedNode, selectedNodeIsAssetSource]);

  const latestNodeStates = useMemo(() => {
    const map: Record<string, string> = {};
    for (const job of jobs) {
      const nodeId = job.nodeRunPayload?.nodeId;
      if (!nodeId || map[nodeId]) {
        continue;
      }
      map[nodeId] = job.state;
    }
    return map;
  }, [jobs]);

  const latestImageAssetByNodeId = useMemo(() => {
    const map = new Map<string, { assetId: string; createdAtMs: number }>();

    for (const job of jobs) {
      if (job.state !== "succeeded") {
        continue;
      }
      const nodeId = job.nodeRunPayload?.nodeId;
      if (!nodeId) {
        continue;
      }

      for (const asset of job.assets || []) {
        if (asset.type !== "image") {
          continue;
        }

        const createdAtMs = new Date(asset.createdAt).getTime();
        const existing = map.get(nodeId);
        if (!existing || createdAtMs > existing.createdAtMs) {
          map.set(nodeId, { assetId: asset.id, createdAtMs });
        }
      }
    }

    return map;
  }, [jobs]);

  const resolveNodeImageAssetId = useCallback(
    (node: WorkflowNode | null | undefined) => {
      if (!node || node.outputType !== "image") {
        return null;
      }

      if (node.sourceAssetId) {
        return node.sourceAssetId;
      }

      return latestImageAssetByNodeId.get(node.id)?.assetId || null;
    },
    [latestImageAssetByNodeId]
  );

  const selectedImageAssetIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of selectedNodes) {
      const assetId = resolveNodeImageAssetId(node);
      if (!assetId || seen.has(assetId)) {
        continue;
      }
      ids.push(assetId);
      seen.add(assetId);
    }
    return ids;
  }, [resolveNodeImageAssetId, selectedNodes]);

  const selectedSingleImageAssetId = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return null;
    }
    return resolveNodeImageAssetId(selectedNode);
  }, [resolveNodeImageAssetId, selectedNode, selectedNodeIds.length]);

  const fetchCanvas = useCallback(async () => {
    const data = await getCanvasWorkspace(projectId);
    const raw = (data.canvas?.canvasDocument || {}) as Record<string, unknown>;
    const viewportRaw = (raw.canvasViewport as Record<string, unknown> | undefined) || {};
    const nodesRaw = Array.isArray((raw.workflow as Record<string, unknown> | undefined)?.nodes)
      ? (((raw.workflow as Record<string, unknown>).nodes as unknown[]) || [])
      : [];

    const nodes = nodesRaw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((node, index) => normalizeNode(node, index));

    setCanvasDoc({
      canvasViewport: {
        x: typeof viewportRaw.x === "number" ? viewportRaw.x : defaultCanvasDocument.canvasViewport.x,
        y: typeof viewportRaw.y === "number" ? viewportRaw.y : defaultCanvasDocument.canvasViewport.y,
        zoom:
          typeof viewportRaw.zoom === "number"
            ? viewportRaw.zoom
            : defaultCanvasDocument.canvasViewport.zoom,
      },
      workflow: {
        nodes,
      },
    });

    setSelectedNodeIds((current) => current.filter((nodeId) => nodes.some((node) => node.id === nodeId)));
  }, [projectId]);

  const fetchJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

  const persistCanvas = useCallback(
    async (doc: CanvasDocument) => {
      await putCanvasWorkspace(projectId, {
        canvasDocument: doc,
      });
    },
    [projectId]
  );

  const queueCanvasSave = useCallback(
    (doc: CanvasDocument) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(() => {
        persistCanvas(doc).catch((error) => {
          console.error("Failed to persist canvas", error);
        });
      }, 360);
    },
    [persistCanvas]
  );

  const selectSingleNode = useCallback((nodeId: string | null) => {
    setSelectedNodeIds(nodeId ? [nodeId] : []);
  }, []);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      }
      return [...prev, nodeId];
    });
  }, []);

  const addNodesToSelection = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds((prev) => {
      const seen = new Set(prev);
      const merged = [...prev];
      for (const nodeId of nodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);
        merged.push(nodeId);
      }
      return merged;
    });
  }, []);

  const buildNodeRunRequest = useCallback(
    (node: WorkflowNode) => {
      const resolvedAssetIds = buildAssetRefsFromNodes(node.upstreamNodeIds, canvasDoc.workflow.nodes);
      return {
        providerId: node.providerId,
        modelId: node.modelId,
        nodePayload: {
          nodeId: node.id,
          nodeType: node.nodeType,
          prompt: node.prompt,
          settings: node.settings,
          outputType: node.outputType,
          upstreamNodeIds: node.upstreamNodeIds,
          upstreamAssetIds: resolvedAssetIds,
        },
      };
    },
    [canvasDoc.workflow.nodes]
  );

  useEffect(() => {
    setIsLoading(true);

    Promise.all([getProviders(), fetchCanvas(), fetchJobs(), openProject(projectId)])
      .then(([nextProviders]) => {
        setProviders(nextProviders);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [fetchCanvas, fetchJobs, projectId]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs().catch(console.error);
    }, 2500);

    return () => clearInterval(interval);
  }, [fetchJobs]);

  useEffect(() => {
    setIsApiPreviewOpen(false);
  }, [primarySelectedNodeId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!modalDragStateRef.current.active) {
        return;
      }

      const modalRect = nodeModalRef.current?.getBoundingClientRect();
      const modalWidth = modalRect?.width || 420;
      const modalHeight = modalRect?.height || 520;
      const maxX = Math.max(10, window.innerWidth - modalWidth - 10);
      const maxY = Math.max(10, window.innerHeight - modalHeight - 10);

      setModalPosition({
        x: Math.min(
          maxX,
          Math.max(10, modalDragStateRef.current.startX + (event.clientX - modalDragStateRef.current.startMouseX))
        ),
        y: Math.min(
          maxY,
          Math.max(10, modalDragStateRef.current.startY + (event.clientY - modalDragStateRef.current.startMouseY))
        ),
      });
    };

    const onPointerUp = () => {
      modalDragStateRef.current.active = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const addNode = useCallback(
    (position?: { x: number; y: number }) => {
      const defaultProvider = fallbackProviderModel(providers);

      setCanvasDoc((prev) => {
        const outputType = resolveOutputType(undefined, getModelSupportedOutputs(defaultProvider));
        const node: WorkflowNode = {
          id: uid(),
          label: `Node ${prev.workflow.nodes.length + 1}`,
          providerId: defaultProvider.providerId,
          modelId: defaultProvider.modelId,
          nodeType: nodeTypeFromOutput(outputType),
          outputType,
          prompt: "",
          settings: {},
          sourceAssetId: null,
          sourceAssetMimeType: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: Math.round(position?.x ?? (120 + (prev.workflow.nodes.length % 4) * 260)),
          y: Math.round(position?.y ?? (120 + Math.floor(prev.workflow.nodes.length / 4) * 160)),
        };

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: [...prev.workflow.nodes, node],
          },
        };

        queueCanvasSave(nextDoc);
        setSelectedNodeIds([node.id]);
        return nextDoc;
      });
    },
    [providers, queueCanvasSave]
  );

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
      setCanvasDoc((prev) => {
        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: prev.workflow.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const uploadFilesToCanvas = useCallback(
    async (files: File[], position?: { x: number; y: number }) => {
      if (files.length === 0) {
        return;
      }

      setIsUploading(true);
      try {
        const uploaded = await Promise.all(
          files.map(async (file) => ({
            file,
            asset: await uploadProjectAsset(projectId, file),
          }))
        );

        const defaultProvider = fallbackProviderModel(providers);
        setCanvasDoc((prev) => {
          const baseX =
            position?.x ?? Math.round(120 + (prev.workflow.nodes.length % 4) * 260);
          const baseY =
            position?.y ?? Math.round(120 + Math.floor(prev.workflow.nodes.length / 4) * 170);

          const sourceNodes = uploaded.map(({ file, asset }, index) => {
            const outputType = outputTypeFromAssetType(asset.type);
            return {
              id: uid(),
              label: normalizeAssetNodeLabel(file.name, index),
              providerId: defaultProvider.providerId,
              modelId: defaultProvider.modelId,
              nodeType: "transform" as const,
              outputType,
              prompt: "",
              settings: { source: "upload" },
              sourceAssetId: asset.id,
              sourceAssetMimeType: asset.mimeType,
              upstreamNodeIds: [],
              upstreamAssetIds: [],
              x: Math.round(baseX + index * 34),
              y: Math.round(baseY + index * 26),
            };
          });

          const nextDoc: CanvasDocument = {
            ...prev,
            workflow: {
              nodes: [...prev.workflow.nodes, ...sourceNodes],
            },
          };

          queueCanvasSave(nextDoc);
          const lastSourceNode = sourceNodes[sourceNodes.length - 1];
          setSelectedNodeIds(lastSourceNode ? [lastSourceNode.id] : []);
          return nextDoc;
        });
      } catch (error) {
        console.error(error);
      } finally {
        setIsUploading(false);
      }
    },
    [projectId, providers, queueCanvasSave]
  );

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) {
        return;
      }

      setCanvasDoc((prev) => {
        const sourceExists = prev.workflow.nodes.some((node) => node.id === sourceNodeId);
        const targetExists = prev.workflow.nodes.some((node) => node.id === targetNodeId);
        if (!sourceExists || !targetExists) {
          return prev;
        }

        const nextNodes = prev.workflow.nodes.map((node) => {
          if (node.id !== targetNodeId) {
            return node;
          }
          const upstreamNodeIds = [...new Set([...node.upstreamNodeIds, sourceNodeId])];
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, prev.workflow.nodes),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const removeNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) {
        return;
      }
      const nodeIdSet = new Set(nodeIds);

      setCanvasDoc((prev) => {
        const remainingNodes = prev.workflow.nodes.filter((node) => !nodeIdSet.has(node.id));
        const nextNodes = remainingNodes.map((node) => {
          const upstreamNodeIds = node.upstreamNodeIds.filter((upstreamNodeId) => !nodeIdSet.has(upstreamNodeId));
          return {
            ...node,
            upstreamNodeIds,
            upstreamAssetIds: buildAssetRefsFromNodes(upstreamNodeIds, remainingNodes),
          };
        });

        const nextDoc: CanvasDocument = {
          ...prev,
          workflow: {
            nodes: nextNodes,
          },
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });

      setSelectedNodeIds((current) => current.filter((nodeId) => !nodeIdSet.has(nodeId)));
    },
    [queueCanvasSave]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (selectedNodeIds.length === 0) {
        return;
      }
      if (isInputLikeElement(event.target)) {
        return;
      }

      event.preventDefault();
      removeNodes(selectedNodeIds);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [removeNodes, selectedNodeIds]);

  const updateViewport = useCallback(
    (nextViewport: CanvasDocument["canvasViewport"]) => {
      setCanvasDoc((prev) => {
        const nextDoc: CanvasDocument = {
          ...prev,
          canvasViewport: nextViewport,
        };

        queueCanvasSave(nextDoc);
        return nextDoc;
      });
    },
    [queueCanvasSave]
  );

  const runNode = useCallback(
    async (node: WorkflowNode) => {
      if (node.sourceAssetId) {
        return;
      }

      const requestPayload = buildNodeRunRequest(node);
      await createJob(projectId, {
        ...node,
        upstreamAssetIds: requestPayload.nodePayload.upstreamAssetIds,
      });
      await fetchJobs();
    },
    [buildNodeRunRequest, fetchJobs, projectId]
  );

  const startDraggingModal = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      modalDragStateRef.current = {
        active: true,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startX: modalPosition.x,
        startY: modalPosition.y,
      };
    },
    [modalPosition.x, modalPosition.y]
  );

  const onFilePickerChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      uploadFilesToCanvas(files).catch(console.error);
    },
    [uploadFilesToCanvas]
  );

  const openAssetViewer = useCallback(
    (assetId: string) => {
      router.push(`/projects/${projectId}/assets/${assetId}`);
    },
    [projectId, router]
  );

  const openCompare = useCallback(
    (mode: "compare_2" | "compare_4", count: number) => {
      const assetIds = selectedImageAssetIds.slice(0, count);
      if (assetIds.length < count) {
        return;
      }
      const params = new URLSearchParams({
        layout: mode,
        assetIds: assetIds.join(","),
      });
      router.push(`/projects/${projectId}/assets?${params.toString()}`);
    },
    [projectId, router, selectedImageAssetIds]
  );

  const apiCallPreviewPayload = useMemo(() => {
    if (!selectedNode || selectedNodeIsAssetSource) {
      return null;
    }
    return buildNodeRunRequest(selectedNode);
  }, [buildNodeRunRequest, selectedNode, selectedNodeIsAssetSource]);

  return (
    <WorkspaceShell projectId={projectId} view="canvas" jobs={jobs} showQueuePill>
      <div className={styles.page}>
        {isLoading ? (
          <div className={styles.loading}>Loading canvas...</div>
        ) : (
          <InfiniteCanvas
            nodes={canvasDoc.workflow.nodes}
            selectedNodeIds={selectedNodeIds}
            viewport={canvasDoc.canvasViewport}
            onSelectSingleNode={selectSingleNode}
            onToggleNodeSelection={toggleNodeSelection}
            onMarqueeSelectNodes={addNodesToSelection}
            onDropNode={(position) => addNode(position)}
            onDropFiles={(files, position) => {
              uploadFilesToCanvas(files, position).catch(console.error);
            }}
            onViewportChange={updateViewport}
            onNodePositionChange={(nodeId, nodePosition) => updateNode(nodeId, nodePosition)}
            onConnectNodes={connectNodes}
            latestNodeStates={latestNodeStates}
          />
        )}

        {selectedNodeIds.length > 0 ? (
          <div className={styles.selectionBar}>
            <span className={styles.selectionCount}>
              {`${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? "" : "s"} selected`}
            </span>

            {selectedSingleImageAssetId ? (
              <button type="button" onClick={() => openAssetViewer(selectedSingleImageAssetId)}>
                View Image
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openCompare("compare_2", 2)}
              disabled={selectedImageAssetIds.length < 2}
            >
              Compare 2
            </button>

            <button
              type="button"
              onClick={() => openCompare("compare_4", 4)}
              disabled={selectedImageAssetIds.length < 4}
            >
              Compare 4
            </button>

            <button type="button" onClick={() => removeNodes(selectedNodeIds)}>
              Delete Selected
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          multiple
          onChange={onFilePickerChange}
        />

        <button
          type="button"
          className={styles.uploadCta}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? "Uploading..." : "Upload Assets"}
        </button>

        {selectedNode && selectedNodeIds.length === 1 ? (
          <section
            ref={(node) => {
              nodeModalRef.current = node;
            }}
            className={styles.nodeModal}
            style={{ left: modalPosition.x, top: modalPosition.y }}
          >
            <header className={styles.nodeModalHeader} onPointerDown={startDraggingModal}>
              <strong>Node Settings</strong>
              <span>Drag me</span>
            </header>

            <div className={styles.nodeModalBody}>
              <input
                className={styles.nodeInput}
                value={selectedNode.label}
                onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
              />

              {selectedNodeIsAssetSource ? (
                <label>
                  Uploaded Source Asset
                  <div className={styles.connectionSummary}>{selectedNode.sourceAssetId}</div>
                </label>
              ) : (
                <div className={styles.nodeGrid}>
                  <label>
                    Provider
                    <select
                      value={selectedNode.providerId}
                      onChange={(event) => {
                        const providerId = event.target.value as WorkflowNode["providerId"];
                        const model = (groupedProviders[providerId] || [])[0];
                        const supportedOutputs = getModelSupportedOutputs(model);
                        const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);

                        updateNode(selectedNode.id, {
                          providerId,
                          modelId: model?.modelId || "",
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
                        });
                      }}
                    >
                      {Object.keys(groupedProviders).map((providerId) => (
                        <option key={providerId} value={providerId}>
                          {providerId}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Model
                    <select
                      value={selectedNode.modelId}
                      onChange={(event) => {
                        const modelId = event.target.value;
                        const model = (groupedProviders[selectedNode.providerId] || []).find(
                          (providerModel) => providerModel.modelId === modelId
                        );
                        const supportedOutputs = getModelSupportedOutputs(model);
                        const outputType = resolveOutputType(selectedNode.outputType, supportedOutputs);

                        updateNode(selectedNode.id, {
                          modelId,
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
                        });
                      }}
                    >
                      {(groupedProviders[selectedNode.providerId] || []).map((model) => (
                        <option key={model.modelId} value={model.modelId}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Node Type
                    <select
                      value={selectedNode.nodeType}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          nodeType: event.target.value as WorkflowNode["nodeType"],
                        })
                      }
                    >
                      <option value="text-gen">text-gen</option>
                      <option value="image-gen">image-gen</option>
                      <option value="video-gen">video-gen</option>
                      <option value="transform">transform</option>
                    </select>
                  </label>

                  <label>
                    Output
                    <select
                      value={selectedNode.outputType}
                      disabled={selectedNodeSupportedOutputs.length <= 1}
                      onChange={(event) => {
                        const outputType = event.target.value as WorkflowNode["outputType"];
                        updateNode(selectedNode.id, {
                          outputType,
                          nodeType: nodeTypeFromOutput(outputType),
                        });
                      }}
                    >
                      {selectedNodeSupportedOutputs.map((outputType) => (
                        <option key={outputType} value={outputType}>
                          {outputType}
                        </option>
                      ))}
                    </select>
                    <small className={styles.helperText}>
                      {selectedNodeSupportedOutputs.length <= 1
                        ? "Output locked by selected model."
                        : "Output options based on selected model."}
                    </small>
                  </label>
                </div>
              )}

              {selectedNodeIsAssetSource ? null : (
                <label>
                  Prompt
                  <textarea
                    className={styles.nodePrompt}
                    value={selectedNode.prompt}
                    onChange={(event) => updateNode(selectedNode.id, { prompt: event.target.value })}
                    placeholder="Describe what this node should generate"
                  />
                </label>
              )}

              <label>
                Connected Inputs
                <div className={styles.connectionSummary}>
                  {selectedNode.upstreamNodeIds.length > 0
                    ? selectedNode.upstreamNodeIds.join(", ")
                    : "No incoming node connections."}
                </div>
              </label>

              {selectedNodeIsAssetSource ? null : (
                <div className={styles.debuggerBlock}>
                  <button
                    type="button"
                    className={styles.debuggerToggle}
                    onClick={() => setIsApiPreviewOpen((value) => !value)}
                  >
                    {isApiPreviewOpen ? "Hide API Call Preview" : "Show API Call Preview"}
                  </button>
                  {isApiPreviewOpen && apiCallPreviewPayload ? (
                    <pre className={styles.debuggerPreview}>
                      {JSON.stringify(apiCallPreviewPayload, null, 2)}
                    </pre>
                  ) : null}
                </div>
              )}

              <div className={styles.nodeModalActions}>
                {selectedNodeIsAssetSource ? null : <button onClick={() => runNode(selectedNode)}>Run Node</button>}
                <button
                  onClick={() =>
                    updateNode(selectedNode.id, {
                      upstreamNodeIds: [],
                      upstreamAssetIds: [],
                    })
                  }
                >
                  Clear Inputs
                </button>
                <button onClick={() => removeNodes([selectedNode.id])}>Delete Node</button>
                <button onClick={() => setSelectedNodeIds([])}>Close</button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
