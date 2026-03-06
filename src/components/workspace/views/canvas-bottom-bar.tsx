"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { getJobDebug } from "@/components/workspace/client-api";
import type {
  GeneratedTextNoteSettings,
  Job,
  JobDebugResponse,
  ListNodeSettings,
  ProviderId,
  ProviderModel,
  WorkflowNode,
} from "@/components/workspace/types";
import type { ModelParameterDefinition } from "@/lib/model-parameters";
import { isRunnableOpenAiImageModel } from "@/lib/openai-image-settings";
import type { TextTemplatePreview } from "@/lib/list-template";
import styles from "./canvas-bottom-bar.module.css";

type SelectOption = {
  value: string;
  label: string;
  statusLabel?: string;
  description?: string;
};

type NodeRunPreview = {
  disabledReason: string | null;
  readyMessage: string | null;
  endpoint: string;
  requestPayload: {
    nodePayload: {
      executionMode: string;
      inputImageAssetIds: string[];
      outputCount: number;
    };
  };
};

type Props = {
  projectId: string;
  selectedNodeIds: string[];
  selectedNode: WorkflowNode | null;
  selectedNodeIsModel: boolean;
  selectedNodeIsTextNote: boolean;
  selectedNodeIsList: boolean;
  selectedNodeIsTextTemplate: boolean;
  selectedNodeIsAssetSource: boolean;
  selectedNodeIsGeneratedAsset: boolean;
  selectedNodeIsGeneratedTextNote: boolean;
  selectedModel: ProviderModel | undefined;
  selectedGeneratedSourceJob: Job | null;
  selectedNodeSourceJobId: string | null;
  selectedNodeResolvedSettings: Record<string, unknown>;
  selectedCoreParameters: ModelParameterDefinition[];
  selectedAdvancedParameters: ModelParameterDefinition[];
  selectedTextNoteTargets: WorkflowNode[];
  selectedInputNodes: WorkflowNode[];
  selectedPromptSourceNode: WorkflowNode | null;
  selectedNodeRunPreview: NodeRunPreview | null;
  selectedListSettings: ListNodeSettings | null;
  selectedTemplatePreview: TextTemplatePreview | null;
  selectedTemplateListNode: WorkflowNode | null;
  selectedGeneratedTextSettings: GeneratedTextNoteSettings | null;
  selectedGeneratedTextTemplateNode: WorkflowNode | null;
  selectedGeneratedTextListNode: WorkflowNode | null;
  selectedImageAssetIds: string[];
  selectedSingleImageAssetId: string | null;
  providerOptions: SelectOption[];
  modelOptions: SelectOption[];
  apiCallPreviewPayload: unknown;
  onLabelChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onProviderChange: (providerId: ProviderId) => void;
  onModelChange: (modelId: string) => void;
  onParameterChange: (parameterKey: string, value: string | number | null) => void;
  onUpdateListColumnLabel: (columnId: string, value: string) => void;
  onUpdateListCell: (rowId: string, columnId: string, value: string) => void;
  onAddListColumn: () => void;
  onRemoveListColumn: (columnId: string) => void;
  onAddListRow: () => void;
  onRemoveListRow: (rowId: string) => void;
  onRun: () => void;
  onDeleteSelection: () => void;
  onClearInputs: () => void;
  onOpenAssetViewer: (assetId: string) => void;
  onOpenCompare: (mode: "compare_2" | "compare_4", count: number) => void;
  onOpenQueueInspect: (jobId: string) => void;
};

type PopoverProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  width: number;
  maxWidth: number;
  popoverRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

function CanvasBarPopover({ anchorEl, open, width, maxWidth, popoverRef, children }: PopoverProps) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setStyle(null);
      return;
    }

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const viewportPadding = 14;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(width, rect.width),
        window.innerWidth - viewportPadding * 2
      );
      let left = rect.left;
      if (left + nextWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - viewportPadding - nextWidth;
      }
      if (left < viewportPadding) {
        left = viewportPadding;
      }

      setStyle({
        left,
        bottom: window.innerHeight - rect.top + 10,
        width: nextWidth,
        maxHeight: Math.max(180, rect.top - 24),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorEl, maxWidth, open, width]);

  if (!open || !anchorEl || !style) {
    return null;
  }

  return createPortal(
    <div ref={popoverRef} className={styles.popover} style={style}>
      {children}
    </div>,
    document.body
  );
}

type SelectProps = {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  openPopoverId: string | null;
  onOpenPopoverChange: (id: string | null) => void;
  onSelect: (value: string) => void;
  triggerRefs: MutableRefObject<Map<string, HTMLButtonElement | null>>;
  popoverRef: RefObject<HTMLDivElement | null>;
};

function CanvasBarSelect({
  id,
  label,
  value,
  options,
  disabled = false,
  openPopoverId,
  onOpenPopoverChange,
  onSelect,
  triggerRefs,
  popoverRef,
}: SelectProps) {
  const activeOption = options.find((option) => option.value === value) || options[0] || null;
  const isOpen = openPopoverId === id;

  return (
    <>
      <button
        ref={(node) => {
          triggerRefs.current.set(id, node);
        }}
        type="button"
        className={`${styles.selectButton} ${isOpen ? styles.selectButtonOpen : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => onOpenPopoverChange(isOpen ? null : id)}
      >
        <span className={styles.controlText}>
          <span className={styles.controlLabel}>{label}</span>
          <span className={styles.controlValueGroup}>
            <span className={styles.controlValue}>{activeOption?.label || value}</span>
            {activeOption?.statusLabel ? <span className={styles.controlMeta}>{activeOption.statusLabel}</span> : null}
          </span>
        </span>
        <span className={styles.caret}>▴</span>
      </button>

      <CanvasBarPopover
        anchorEl={triggerRefs.current.get(id) || null}
        open={isOpen}
        width={260}
        maxWidth={340}
        popoverRef={popoverRef}
      >
        <div className={styles.popoverHeader}>
          <strong>{label}</strong>
          <span>{options.length} options</span>
        </div>
        <div className={styles.popoverBody}>
          <div className={styles.selectList} role="listbox" aria-label={label}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.selectOption} ${option.value === value ? styles.selectOptionActive : ""}`}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onSelect(option.value);
                  onOpenPopoverChange(null);
                }}
              >
                <span className={styles.selectOptionTopRow}>
                  <span className={styles.selectOptionLabel}>{option.label}</span>
                  {option.statusLabel ? <span className={styles.selectOptionMeta}>{option.statusLabel}</span> : null}
                </span>
                {option.description ? (
                  <span className={styles.selectOptionDescription}>{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </CanvasBarPopover>
    </>
  );
}

type TrayProps = {
  id: string;
  label: string;
  value: string;
  width?: number;
  maxWidth?: number;
  openPopoverId: string | null;
  onOpenPopoverChange: (id: string | null) => void;
  triggerRefs: MutableRefObject<Map<string, HTMLButtonElement | null>>;
  popoverRef: RefObject<HTMLDivElement | null>;
  headerNote?: string;
  children: ReactNode;
};

function CanvasBarTray({
  id,
  label,
  value,
  width = 360,
  maxWidth = 520,
  openPopoverId,
  onOpenPopoverChange,
  triggerRefs,
  popoverRef,
  headerNote,
  children,
}: TrayProps) {
  const isOpen = openPopoverId === id;

  return (
    <>
      <button
        ref={(node) => {
          triggerRefs.current.set(id, node);
        }}
        type="button"
        className={`${styles.trayButton} ${isOpen ? styles.trayButtonOpen : ""}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => onOpenPopoverChange(isOpen ? null : id)}
      >
        <span className={styles.controlText}>
          <span className={styles.controlLabel}>{label}</span>
          <span className={styles.controlValue}>{value}</span>
        </span>
        <span className={styles.caret}>▴</span>
      </button>

      <CanvasBarPopover
        anchorEl={triggerRefs.current.get(id) || null}
        open={isOpen}
        width={width}
        maxWidth={maxWidth}
        popoverRef={popoverRef}
      >
        <div className={styles.popoverHeader}>
          <strong>{label}</strong>
          <span>{headerNote || "Opens above the bar"}</span>
        </div>
        <div className={styles.popoverBody}>{children}</div>
      </CanvasBarPopover>
    </>
  );
}

function InlineParameterField({
  parameter,
  value,
  onChange,
  openPopoverId,
  onOpenPopoverChange,
  triggerRefs,
  popoverRef,
}: {
  parameter: ModelParameterDefinition;
  value: unknown;
  onChange: (nextValue: string | number | null) => void;
  openPopoverId: string | null;
  onOpenPopoverChange: (id: string | null) => void;
  triggerRefs: MutableRefObject<Map<string, HTMLButtonElement | null>>;
  popoverRef: RefObject<HTMLDivElement | null>;
}) {
  if (parameter.control === "select") {
    return (
      <CanvasBarSelect
        id={`parameter:${parameter.key}`}
        label={parameter.label}
        value={String(value ?? parameter.defaultValue ?? "")}
        options={(parameter.options || []).map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
        openPopoverId={openPopoverId}
        onOpenPopoverChange={onOpenPopoverChange}
        onSelect={(nextValue) => onChange(nextValue)}
        triggerRefs={triggerRefs}
        popoverRef={popoverRef}
      />
    );
  }

  return (
    <label className={styles.numberField}>
      <span className={styles.fieldLabel}>{parameter.label}</span>
      <input
        className={styles.numberInput}
        type="number"
        inputMode="numeric"
        min={parameter.min}
        max={parameter.max}
        step={parameter.step}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={parameter.placeholder}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function selectionChipLabel(selectedNodeIds: string[], selectedNode: WorkflowNode | null) {
  if (selectedNodeIds.length > 1) {
    return `${selectedNodeIds.length} selected`;
  }
  if (!selectedNode) {
    return null;
  }
  if (selectedNode.kind === "model") {
    return "1 model";
  }
  if (selectedNode.kind === "text-note") {
    return "1 note";
  }
  if (selectedNode.kind === "list") {
    return "1 list";
  }
  if (selectedNode.kind === "text-template") {
    return "1 template";
  }
  return "1 asset";
}

function summarizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "Add";
  }
  return trimmed.length <= 18 ? trimmed : `${trimmed.slice(0, 16)}...`;
}

function summarizeConnections(nodes: WorkflowNode[]) {
  if (nodes.length === 0) {
    return "None";
  }
  if (nodes.length === 1) {
    return nodes[0].label;
  }
  return `${nodes.length} linked`;
}

function summarizeList(settings: ListNodeSettings | null) {
  if (!settings) {
    return "0 × 0";
  }
  return `${settings.columns.length} × ${settings.rows.length}`;
}

function renderAdvancedSummary(parameters: ModelParameterDefinition[]) {
  if (parameters.length === 0) {
    return "None";
  }
  return `${parameters.length} controls`;
}

function applyMainLaneWheel(
  container: HTMLDivElement,
  deltaX: number,
  deltaY: number
) {
  if (container.scrollWidth <= container.clientWidth + 1) {
    return false;
  }

  const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) && deltaX !== 0 ? deltaX : deltaY;
  if (dominantDelta === 0) {
    return false;
  }

  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft + dominantDelta));
  container.scrollLeft = nextScrollLeft;
  return true;
}

export function CanvasBottomBar({
  projectId,
  selectedNodeIds,
  selectedNode,
  selectedNodeIsModel,
  selectedNodeIsTextNote,
  selectedNodeIsList,
  selectedNodeIsTextTemplate,
  selectedNodeIsAssetSource,
  selectedNodeIsGeneratedAsset,
  selectedNodeIsGeneratedTextNote,
  selectedModel,
  selectedGeneratedSourceJob,
  selectedNodeSourceJobId,
  selectedNodeResolvedSettings,
  selectedCoreParameters,
  selectedAdvancedParameters,
  selectedTextNoteTargets,
  selectedInputNodes,
  selectedPromptSourceNode,
  selectedNodeRunPreview,
  selectedListSettings,
  selectedTemplatePreview,
  selectedTemplateListNode,
  selectedGeneratedTextSettings,
  selectedGeneratedTextTemplateNode,
  selectedGeneratedTextListNode,
  selectedImageAssetIds,
  selectedSingleImageAssetId,
  providerOptions,
  modelOptions,
  apiCallPreviewPayload,
  onLabelChange,
  onPromptChange,
  onProviderChange,
  onModelChange,
  onParameterChange,
  onUpdateListColumnLabel,
  onUpdateListCell,
  onAddListColumn,
  onRemoveListColumn,
  onAddListRow,
  onRemoveListRow,
  onRun,
  onDeleteSelection,
  onClearInputs,
  onOpenAssetViewer,
  onOpenCompare,
  onOpenQueueInspect,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mainLaneRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [sourceCallDebug, setSourceCallDebug] = useState<JobDebugResponse | null>(null);
  const [sourceCallLoading, setSourceCallLoading] = useState(false);
  const [sourceCallError, setSourceCallError] = useState<string | null>(null);

  const sourceCallLatestAttempt = sourceCallDebug?.attempts[0] || null;
  const selectionKey = useMemo(
    () => `${selectedNodeIds.join(",")}:${selectedNode?.id || ""}`,
    [selectedNode?.id, selectedNodeIds]
  );
  const selectionChip = selectionChipLabel(selectedNodeIds, selectedNode);
  const showCompareActions = selectedNodeIds.length > 1;

  useEffect(() => {
    setOpenPopoverId(null);
    setSourceCallDebug(null);
    setSourceCallLoading(false);
    setSourceCallError(null);
  }, [selectionKey]);

  useEffect(() => {
    if (!openPopoverId) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && rootRef.current.contains(target)) {
        return;
      }
      if (popoverRef.current && target && popoverRef.current.contains(target)) {
        return;
      }
      setOpenPopoverId(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPopoverId(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openPopoverId]);

  useEffect(() => {
    if (openPopoverId !== "source-call" || !selectedNodeSourceJobId) {
      return;
    }

    let canceled = false;
    setSourceCallLoading(true);
    getJobDebug(projectId, selectedNodeSourceJobId)
      .then((response) => {
        if (canceled) {
          return;
        }
        setSourceCallDebug(response);
        setSourceCallError(null);
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        setSourceCallDebug(null);
        setSourceCallError(error instanceof Error ? error.message : "Failed to load source call.");
      })
      .finally(() => {
        if (!canceled) {
          setSourceCallLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [openPopoverId, projectId, selectedNodeSourceJobId]);

  useEffect(() => {
    const container = mainLaneRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => {
      if (openPopoverId) {
        setOpenPopoverId(null);
      }
    };

    const onWheel = (event: WheelEvent) => {
      const didScroll = applyMainLaneWheel(container, event.deltaX, event.deltaY);
      if (!didScroll) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (openPopoverId) {
        setOpenPopoverId(null);
      }
    };

    container.addEventListener("scroll", onScroll);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
    };
  }, [openPopoverId]);

  const handleMainLaneWheelCapture = (event: ReactWheelEvent<HTMLDivElement>) => {
    const container = mainLaneRef.current;
    if (!container) {
      return;
    }

    const didScroll = applyMainLaneWheel(container, event.deltaX, event.deltaY);
    if (!didScroll) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (openPopoverId) {
      setOpenPopoverId(null);
    }
  };

  if (selectedNodeIds.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className={styles.barRoot}>
      <div ref={mainLaneRef} className={styles.mainLane} onWheelCapture={handleMainLaneWheelCapture}>
        <div className={styles.mainLaneScroll}>
          {selectionChip ? <span className={styles.chip}>{selectionChip}</span> : null}

          {selectedNode && selectedNodeIds.length === 1 ? (
            <label className={styles.textField}>
              <span className={styles.fieldLabel}>Label</span>
              <input
                className={styles.textInput}
                value={selectedNode.label}
                onChange={(event) => onLabelChange(event.target.value)}
              />
            </label>
          ) : null}

            {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsModel ? (
              <>
                <CanvasBarSelect
                  id="provider"
                  label="Provider"
                  value={selectedNode.providerId}
                  options={providerOptions}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  onSelect={(providerId) => onProviderChange(providerId as ProviderId)}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                />

                <CanvasBarSelect
                  id="model"
                  label="Model"
                  value={selectedNode.modelId}
                  options={modelOptions}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  onSelect={onModelChange}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                />

                <CanvasBarTray
                  id="prompt"
                  label="Prompt"
                  value={selectedPromptSourceNode ? "Fallback" : summarizePrompt(selectedNode.prompt)}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                  headerNote={selectedPromptSourceNode ? "Connected note overrides on run" : "Fallback prompt text"}
                >
                  <div className={styles.traySection}>
                    <label className={styles.traySectionLabel} htmlFor="canvas-bar-prompt">
                      Prompt
                    </label>
                    <textarea
                      id="canvas-bar-prompt"
                      className={styles.trayTextarea}
                      value={selectedNode.prompt}
                      onChange={(event) => onPromptChange(event.target.value)}
                      placeholder="Describe what this node should generate"
                    />
                  </div>
                  {selectedPromptSourceNode ? (
                    <div className={styles.traySection}>
                      <span className={styles.traySectionLabel}>Connected Prompt Note</span>
                      <div className={styles.traySummary}>
                        <strong>{selectedPromptSourceNode.label}</strong>
                        {selectedPromptSourceNode.prompt.trim()
                          ? `: ${selectedPromptSourceNode.prompt.trim()}`
                          : ": Empty note"}
                      </div>
                    </div>
                  ) : null}
                </CanvasBarTray>

                {selectedCoreParameters.map((parameter) => (
                  <InlineParameterField
                    key={parameter.key}
                    parameter={parameter}
                    value={selectedNodeResolvedSettings[parameter.key]}
                    onChange={(value) => onParameterChange(parameter.key, value)}
                    openPopoverId={openPopoverId}
                    onOpenPopoverChange={setOpenPopoverId}
                    triggerRefs={triggerRefs}
                    popoverRef={popoverRef}
                  />
                ))}

                {selectedAdvancedParameters.length > 0 ? (
                  <CanvasBarTray
                    id="advanced"
                    label="Advanced"
                    value={renderAdvancedSummary(selectedAdvancedParameters)}
                    width={380}
                    maxWidth={540}
                    openPopoverId={openPopoverId}
                    onOpenPopoverChange={setOpenPopoverId}
                    triggerRefs={triggerRefs}
                    popoverRef={popoverRef}
                  >
                    <div className={styles.trayGrid}>
                      {selectedAdvancedParameters.map((parameter) => (
                        <div key={parameter.key} className={styles.traySection}>
                          <span className={styles.traySectionLabel}>{parameter.label}</span>
                          {parameter.control === "select" ? (
                            <select
                              className={styles.trayInput}
                              value={String(selectedNodeResolvedSettings[parameter.key] ?? parameter.defaultValue ?? "")}
                              onChange={(event) => onParameterChange(parameter.key, event.target.value)}
                            >
                              {(parameter.options || []).map((option) => (
                                <option key={String(option.value)} value={String(option.value)}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className={styles.trayNumberInput}
                              type="number"
                              inputMode="numeric"
                              min={parameter.min}
                              max={parameter.max}
                              step={parameter.step}
                              value={
                                selectedNodeResolvedSettings[parameter.key] === null ||
                                selectedNodeResolvedSettings[parameter.key] === undefined
                                  ? ""
                                  : String(selectedNodeResolvedSettings[parameter.key])
                              }
                              placeholder={parameter.placeholder}
                              onChange={(event) =>
                                onParameterChange(
                                  parameter.key,
                                  event.target.value === "" ? null : Number(event.target.value)
                                )
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </CanvasBarTray>
                ) : null}

                <CanvasBarTray
                  id="details"
                  label="Details"
                  value={selectedNodeRunPreview?.disabledReason ? "Attention" : "Ready"}
                  width={420}
                  maxWidth={580}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  {selectedNodeRunPreview ? (
                    <div className={styles.traySection}>
                      <span className={styles.traySectionLabel}>Execution</span>
                      <div className={styles.traySummary}>
                        {isRunnableOpenAiImageModel(selectedModel?.providerId, selectedModel?.modelId)
                          ? selectedNodeRunPreview.requestPayload.nodePayload.executionMode === "edit"
                            ? `Reference-image generation from ${selectedNodeRunPreview.requestPayload.nodePayload.inputImageAssetIds.length} image input${
                                selectedNodeRunPreview.requestPayload.nodePayload.inputImageAssetIds.length === 1 ? "" : "s"
                              } to ${selectedNodeRunPreview.requestPayload.nodePayload.outputCount} output${
                                selectedNodeRunPreview.requestPayload.nodePayload.outputCount === 1 ? "" : "s"
                              }.`
                            : `Prompt-only generation to ${selectedNodeRunPreview.requestPayload.nodePayload.outputCount} output${
                                selectedNodeRunPreview.requestPayload.nodePayload.outputCount === 1 ? "" : "s"
                              }.`
                          : selectedNodeRunPreview.readyMessage || `Execution via ${selectedNodeRunPreview.endpoint}.`}
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Connected Inputs</span>
                    <div className={styles.traySummary}>
                      {selectedInputNodes.length > 0
                        ? selectedInputNodes.map((node) => node.label).join(", ")
                        : "No incoming node connections."}
                    </div>
                  </div>

                  {selectedNodeRunPreview ? (
                    <div className={styles.traySection}>
                      <span className={styles.traySectionLabel}>Run Readiness</span>
                      <div
                        className={`${styles.traySummary} ${
                          selectedNodeRunPreview.disabledReason
                            ? styles.traySummaryWarning
                            : styles.traySummaryReady
                        }`}
                      >
                        {selectedNodeRunPreview.disabledReason
                          ? selectedNodeRunPreview.disabledReason
                          : `${selectedNodeRunPreview.readyMessage} via ${selectedNodeRunPreview.endpoint}.`}
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.trayActions}>
                    <button type="button" className={styles.actionButton} onClick={onClearInputs}>
                      Clear Inputs
                    </button>
                  </div>
                </CanvasBarTray>

                {apiCallPreviewPayload ? (
                  <CanvasBarTray
                    id="api"
                    label="API"
                    value="Preview"
                    width={460}
                    maxWidth={640}
                    openPopoverId={openPopoverId}
                    onOpenPopoverChange={setOpenPopoverId}
                    triggerRefs={triggerRefs}
                    popoverRef={popoverRef}
                  >
                    <pre className={styles.trayCode}>{JSON.stringify(apiCallPreviewPayload, null, 2)}</pre>
                  </CanvasBarTray>
                ) : null}
              </>
            ) : null}

            {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsList ? (
              <>
                <CanvasBarTray
                  id="list"
                  label="List"
                  value={summarizeList(selectedListSettings)}
                  width={680}
                  maxWidth={860}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Columns and Rows</span>
                    <div className={styles.listEditor}>
                      <div className={styles.listEditorHeader}>
                        {(selectedListSettings?.columns || []).map((column) => (
                          <div key={column.id} className={styles.listEditorColumn}>
                            <input
                              className={styles.trayInput}
                              value={column.label}
                              onChange={(event) => onUpdateListColumnLabel(column.id, event.target.value)}
                              placeholder="Column name"
                            />
                            <button
                              type="button"
                              className={styles.inlineActionButton}
                              onClick={() => onRemoveListColumn(column.id)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className={styles.listEditorRows}>
                        {(selectedListSettings?.rows || []).map((row, rowIndex) => (
                          <div key={row.id} className={styles.listEditorRow}>
                            <span className={styles.listEditorRowLabel}>{`Row ${rowIndex + 1}`}</span>
                            {(selectedListSettings?.columns || []).map((column) => (
                              <input
                                key={`${row.id}:${column.id}`}
                                className={styles.trayInput}
                                value={row.values[column.id] ?? ""}
                                onChange={(event) => onUpdateListCell(row.id, column.id, event.target.value)}
                                placeholder={column.label.trim() || "Value"}
                              />
                            ))}
                            <button
                              type="button"
                              className={styles.inlineActionButton}
                              onClick={() => onRemoveListRow(row.id)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className={styles.trayActions}>
                    <button type="button" className={styles.actionButton} onClick={onAddListColumn}>
                      Add Column
                    </button>
                    <button type="button" className={styles.actionButton} onClick={onAddListRow}>
                      Add Row
                    </button>
                  </div>
                </CanvasBarTray>
              </>
            ) : null}

            {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsTextTemplate ? (
              <>
                <CanvasBarTray
                  id="template"
                  label="Template"
                  value={summarizePrompt(selectedNode.prompt)}
                  width={460}
                  maxWidth={620}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Template Text</span>
                    <textarea
                      className={styles.trayTextarea}
                      value={selectedNode.prompt}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(event) => onPromptChange(event.target.value)}
                      placeholder="Write merge text with [[column]] placeholders"
                    />
                  </div>
                </CanvasBarTray>

                <CanvasBarTray
                  id="template-details"
                  label="Details"
                  value={selectedTemplatePreview?.disabledReason ? "Attention" : "Ready"}
                  width={420}
                  maxWidth={600}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Connected List</span>
                    <div className={styles.traySummary}>
                      {selectedTemplateListNode ? selectedTemplateListNode.label : "No list connected."}
                    </div>
                  </div>
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Registered Columns</span>
                    <div className={styles.traySummary}>
                      {selectedTemplatePreview && selectedTemplatePreview.columns.length > 0
                        ? selectedTemplatePreview.columns.map((column) => column.label.trim() || "Untitled").join(", ")
                        : "No columns registered yet."}
                    </div>
                  </div>
                  {selectedTemplatePreview?.unresolvedTokens.length ? (
                    <div className={styles.traySection}>
                      <span className={styles.traySectionLabel}>Unresolved Placeholders</span>
                      <div className={`${styles.traySummary} ${styles.traySummaryWarning}`}>
                        {selectedTemplatePreview.unresolvedTokens.map((token) => token.label).join(", ")}
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Run Readiness</span>
                    <div
                      className={`${styles.traySummary} ${
                        selectedTemplatePreview?.disabledReason ? styles.traySummaryWarning : styles.traySummaryReady
                      }`}
                    >
                      {selectedTemplatePreview?.disabledReason ||
                        selectedTemplatePreview?.readyMessage ||
                        "Connect a list to generate rows."}
                    </div>
                  </div>
                  <div className={styles.trayActions}>
                    <button type="button" className={styles.actionButton} onClick={onClearInputs}>
                      Clear List
                    </button>
                  </div>
                </CanvasBarTray>
              </>
            ) : null}

            {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsTextNote ? (
              <>
                <CanvasBarTray
                  id="note"
                  label="Note"
                  value={summarizePrompt(selectedNode.prompt)}
                  width={420}
                  maxWidth={560}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Note Text</span>
                    <textarea
                      className={styles.trayTextarea}
                      value={selectedNode.prompt}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(event) => onPromptChange(event.target.value)}
                      placeholder="Write prompt notes here"
                    />
                  </div>
                </CanvasBarTray>

                <CanvasBarTray
                  id="note-links"
                  label="Details"
                  value={selectedNodeIsGeneratedTextNote ? "Generated" : summarizeConnections(selectedTextNoteTargets)}
                  width={360}
                  maxWidth={520}
                  openPopoverId={openPopoverId}
                  onOpenPopoverChange={setOpenPopoverId}
                  triggerRefs={triggerRefs}
                  popoverRef={popoverRef}
                >
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Connection State</span>
                    <div className={styles.traySummary}>
                      {selectedNodeIsGeneratedTextNote
                        ? "Generated notes are editable prompt sources."
                        : "Text notes connect to model nodes as external prompt sources."}
                    </div>
                  </div>
                  <div className={styles.traySection}>
                    <span className={styles.traySectionLabel}>Connected Targets</span>
                    <div className={styles.traySummary}>
                      {selectedTextNoteTargets.length > 0
                        ? selectedTextNoteTargets.map((node) => node.label).join(", ")
                        : "No model nodes are using this note yet."}
                    </div>
                  </div>
                  {selectedNodeIsGeneratedTextNote && selectedGeneratedTextSettings ? (
                    <>
                      <div className={styles.traySection}>
                        <span className={styles.traySectionLabel}>Generated From</span>
                        <div className={styles.traySummary}>
                          {selectedGeneratedTextTemplateNode?.label || selectedGeneratedTextSettings.sourceTemplateNodeId}
                          {" via "}
                          {selectedGeneratedTextListNode?.label || selectedGeneratedTextSettings.sourceListNodeId}
                        </div>
                      </div>
                      <div className={styles.traySection}>
                        <span className={styles.traySectionLabel}>Batch Metadata</span>
                        <div className={styles.traySummary}>
                          {`Batch ${selectedGeneratedTextSettings.batchId} · Row ${selectedGeneratedTextSettings.rowIndex + 1}`}
                        </div>
                      </div>
                    </>
                  ) : null}
                </CanvasBarTray>
              </>
            ) : null}

            {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsAssetSource ? (
                <>
                  <CanvasBarTray
                    id="asset-details"
                    label="Details"
                    value={selectedNodeIsGeneratedAsset ? "Generated" : "Uploaded"}
                    width={380}
                    maxWidth={520}
                    openPopoverId={openPopoverId}
                    onOpenPopoverChange={setOpenPopoverId}
                    triggerRefs={triggerRefs}
                    popoverRef={popoverRef}
                  >
                    <div className={styles.traySection}>
                      <span className={styles.traySectionLabel}>
                        {selectedNodeIsGeneratedAsset ? "Generated Output Node" : "Uploaded Source Asset"}
                      </span>
                      <div className={styles.traySummary}>
                        {selectedNode.sourceAssetId || "Waiting for generated image output."}
                      </div>
                    </div>

                    {selectedNodeIsGeneratedAsset ? (
                      <div className={styles.traySection}>
                        <span className={styles.traySectionLabel}>Generation Origin</span>
                        <div className={styles.traySummary}>
                          <strong>{selectedNode.providerId}</strong>
                          {` / ${selectedNode.modelId} · `}
                          {selectedGeneratedSourceJob?.state ||
                            selectedNode.processingState ||
                            (selectedNode.sourceAssetId ? "succeeded" : "pending")}
                          {typeof selectedNode.sourceOutputIndex === "number"
                            ? ` · variant ${selectedNode.sourceOutputIndex + 1}`
                            : ""}
                          {selectedNodeSourceJobId ? ` · ${selectedNodeSourceJobId}` : ""}
                        </div>
                      </div>
                    ) : null}
                  </CanvasBarTray>

                  {selectedNodeIsGeneratedAsset && selectedNodeSourceJobId ? (
                    <CanvasBarTray
                      id="source-call"
                      label="Source"
                      value={selectedGeneratedSourceJob?.state || "Inspect"}
                      width={480}
                      maxWidth={660}
                      openPopoverId={openPopoverId}
                      onOpenPopoverChange={setOpenPopoverId}
                      triggerRefs={triggerRefs}
                      popoverRef={popoverRef}
                      headerNote={selectedNodeSourceJobId}
                    >
                      {sourceCallLoading ? (
                        <div className={styles.traySummary}>Loading source call…</div>
                      ) : sourceCallError ? (
                        <div className={`${styles.traySummary} ${styles.traySummaryWarning}`}>{sourceCallError}</div>
                      ) : sourceCallDebug ? (
                        <>
                          <div className={styles.traySummary}>
                            {`Job ${sourceCallDebug.job.id} · ${sourceCallDebug.job.state} · ${sourceCallDebug.attempts.length} attempt${
                              sourceCallDebug.attempts.length === 1 ? "" : "s"
                            }`}
                          </div>
                          <pre className={styles.trayCode}>
                            {JSON.stringify(
                              {
                                request: sourceCallLatestAttempt?.providerRequest || null,
                                response: sourceCallLatestAttempt?.providerResponse || null,
                                error:
                                  sourceCallLatestAttempt?.errorCode || sourceCallLatestAttempt?.errorMessage
                                    ? {
                                        code: sourceCallLatestAttempt?.errorCode || "ERROR",
                                        message: sourceCallLatestAttempt?.errorMessage || "Unknown error",
                                      }
                                    : null,
                              },
                              null,
                              2
                            )}
                          </pre>
                        </>
                      ) : (
                        <div className={styles.traySummary}>No source call details found.</div>
                      )}
                    </CanvasBarTray>
                  ) : null}
                </>
            ) : null}
        </div>
      </div>

      <div className={styles.actionLane}>
        {selectedNode && selectedNodeIds.length === 1 && selectedNodeIsGeneratedAsset && selectedNodeSourceJobId ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => onOpenQueueInspect(selectedNodeSourceJobId)}
          >
            Queue
          </button>
        ) : null}

          {selectedNode && selectedNodeIds.length === 1 && selectedSingleImageAssetId ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onOpenAssetViewer(selectedSingleImageAssetId)}
            >
              View Image
            </button>
          ) : null}

          {selectedNode && selectedNodeIds.length === 1 && (selectedNodeIsModel || selectedNodeIsTextTemplate) ? (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
              disabled={selectedNodeIsTextTemplate ? Boolean(selectedTemplatePreview?.disabledReason) : Boolean(selectedNodeRunPreview?.disabledReason)}
              onClick={onRun}
            >
              {selectedNodeIsTextTemplate ? "Generate Rows" : "Run Node"}
            </button>
          ) : null}

          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            onClick={onDeleteSelection}
          >
            {selectedNodeIds.length === 1 ? "Delete Node" : "Delete Selected"}
          </button>

        {showCompareActions ? (
          <>
            <button
              type="button"
              className={styles.actionButton}
              disabled={selectedImageAssetIds.length !== 2}
              onClick={() => onOpenCompare("compare_2", 2)}
            >
              Compare 2
            </button>
            <button
              type="button"
              className={styles.actionButton}
              disabled={selectedImageAssetIds.length !== 4}
              onClick={() => onOpenCompare("compare_4", 4)}
            >
              Compare 4
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
