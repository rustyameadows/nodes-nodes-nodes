"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SearchableModelSelect } from "@/components/searchable-model-select";
import type { CanvasRenderNode } from "@/components/canvas-node-types";
import type {
  ListNodeSettings,
  ProviderModel,
  WorkflowNode,
} from "@/components/workspace/types";
import { getCanvasNodeActionDescriptors } from "@/lib/canvas-node-actions";
import { getListNodeSettings } from "@/lib/list-template";
import type { TextTemplatePreview } from "@/lib/list-template";
import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { NodeCatalogVariant } from "@/lib/node-catalog";
import styles from "./canvas-node.module.css";

type RunPreview = {
  disabledReason: string | null;
  readyMessage: string | null;
  endpoint: string;
};

export type ActiveCanvasNodeEditorState = {
  nodeId: string;
  selectedNode: WorkflowNode;
  selectedModel?: ProviderModel;
  selectedNodeRunPreview: RunPreview | null;
  selectedNodeResolvedSettings: Record<string, unknown>;
  selectedCoreParameters: ModelParameterDefinition[];
  selectedAdvancedParameters: ModelParameterDefinition[];
  selectedInputNodes: WorkflowNode[];
  selectedPromptSourceNode: WorkflowNode | null;
  selectedListSettings: ListNodeSettings | null;
  selectedTemplatePreview: TextTemplatePreview | null;
  selectedTemplateListNode: WorkflowNode | null;
  selectedNodeSourceJobId: string | null;
  selectedSingleImageAssetId: string | null;
  modelCatalogVariants: NodeCatalogVariant[];
};

type Props = {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  pickerDismissKey?: string | number | null;
  onSetDisplayMode: (mode: "preview" | "compact") => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onRunNode: () => void;
  onLabelChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onModelVariantChange: (variantId: string) => void;
  onParameterChange: (parameterKey: string, value: string | number | null) => void;
  onUpdateListColumnLabel: (columnId: string, label: string) => void;
  onUpdateListCell: (rowId: string, columnId: string, value: string) => void;
  onAddListColumn: () => void;
  onRemoveListColumn: (columnId: string) => void;
  onAddListRow: (initialValues?: Record<string, string>) => string | null | void;
  onRemoveListRow: (rowId: string) => void;
  onClearInputs: () => void;
  onOpenAssetViewer: (assetId: string) => void;
  onDownloadAssets: (assetIds: string[]) => void;
  onOpenQueueInspect: (jobId: string) => void;
  onCommitTextEdits: () => void;
};

type NodeActionHandlerMap = Record<string, () => void>;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function spreadsheetColumnLabel(index: number) {
  let label = "";
  let cursor = index;

  while (cursor >= 0) {
    label = String.fromCharCode(65 + (cursor % 26)) + label;
    cursor = Math.floor(cursor / 26) - 1;
  }

  return label;
}

function renderParameterField(
  definition: ModelParameterDefinition,
  value: unknown,
  onChange: (value: string | number | null) => void,
  onBlur: () => void
) {
  if (definition.control === "select") {
    return (
      <select
        className={styles.fieldControl}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        onBlur={onBlur}
        onPointerDown={stopPointer}
      >
        <option value="">Unset</option>
        {(definition.options || []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (definition.control === "number") {
    return (
      <input
        className={styles.fieldControl}
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={definition.placeholder}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        onBlur={onBlur}
        onPointerDown={stopPointer}
      />
    );
  }

  if (definition.control === "textarea") {
    return (
      <textarea
        className={cx(styles.fieldControl, styles.fieldControlTextarea)}
        rows={definition.rows || 4}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={definition.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onPointerDown={stopPointer}
      />
    );
  }

  return (
    <input
      className={styles.fieldControl}
      type="text"
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={definition.placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onPointerDown={stopPointer}
    />
  );
}

function NodeTitleRail({
  node,
  activeEditor,
  secondaryLabel,
  onLabelChange,
  onCommitTextEdits,
}: {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  secondaryLabel: string;
  onLabelChange: (value: string) => void;
  onCommitTextEdits: () => void;
}) {
  return (
    <div className={styles.titleRail} data-node-drag-handle="true">
      <div className={styles.titleRailCopy}>
        {activeEditor ? (
          <input
            className={styles.titleInput}
            value={activeEditor.selectedNode.label}
            onChange={(event) => onLabelChange(event.target.value)}
            onBlur={onCommitTextEdits}
            onPointerDown={stopPointer}
          />
        ) : (
          <span className={styles.titleLabel}>{node.label}</span>
        )}
        <span className={styles.titleMeta}>{secondaryLabel}</span>
      </div>
      <span className={styles.dragRail} aria-hidden="true" />
    </div>
  );
}

function NodeActionRail({
  descriptors,
  handlers,
}: {
  descriptors: ReturnType<typeof getCanvasNodeActionDescriptors>;
  handlers: NodeActionHandlerMap;
}) {
  if (descriptors.length === 0) {
    return null;
  }

  return (
    <div className={styles.actionRail}>
      {descriptors.map((descriptor) => (
        <button
          key={descriptor.id}
          type="button"
          className={cx(styles.actionButton, descriptor.tone === "accent" && styles.actionButtonAccent)}
          disabled={descriptor.disabled}
          onPointerDown={stopPointer}
          onClick={() => {
            handlers[descriptor.id]?.();
          }}
        >
          {descriptor.label}
        </button>
      ))}
    </div>
  );
}

function NodeExternalBadge({
  children,
  align = "input",
}: {
  children: string;
  align?: "input" | "top-right";
}) {
  return (
    <div className={cx(styles.externalBadge, align === "input" ? styles.externalBadgeInput : styles.externalBadgeTopRight)}>
      {children}
    </div>
  );
}

function NodeFrame({
  node,
  activeEditor,
  titleLabel,
  actionDescriptors,
  actionHandlers,
  externalBadge,
  onLabelChange,
  onCommitTextEdits,
  children,
}: {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  titleLabel: string;
  actionDescriptors: ReturnType<typeof getCanvasNodeActionDescriptors>;
  actionHandlers: NodeActionHandlerMap;
  externalBadge?: ReactNode;
  onLabelChange: (value: string) => void;
  onCommitTextEdits: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={styles.nodeChrome}
      data-kind={node.kind}
      data-render-mode={node.presentation.renderMode}
      data-active={node.presentation.isExpanded ? "true" : "false"}
      data-editing={node.presentation.isEditing ? "true" : "false"}
    >
      {node.presentation.showTitleRail ? (
        <NodeTitleRail
          node={node}
          activeEditor={activeEditor}
          secondaryLabel={titleLabel}
          onLabelChange={onLabelChange}
          onCommitTextEdits={onCommitTextEdits}
        />
      ) : null}
      {node.presentation.showExternalBadges && externalBadge ? externalBadge : null}
      {children ? <div className={styles.nodeViewport}>{children}</div> : null}
      {node.presentation.showActionRail ? (
        <NodeActionRail descriptors={actionDescriptors} handlers={actionHandlers} />
      ) : null}
    </div>
  );
}

function CompactNode({ node }: { node: CanvasRenderNode }) {
  return (
    <div className={styles.compactNode}>
      <strong>{node.label}</strong>
      <span>{node.kind === "model" ? node.displayModelName || node.modelId : node.kind}</span>
    </div>
  );
}

function PreviewModelNode({ node }: { node: CanvasRenderNode }) {
  const secondaryLine = node.promptSourceNodeId
    ? "Prompt note connected"
    : node.prompt.trim()
      ? "Prompt ready"
      : "No prompt";

  return (
    <div className={styles.modelPreview}>
      <div className={styles.previewHeader}>
        <strong>{node.displayModelName || node.modelId}</strong>
        <span>{node.outputType}</span>
      </div>
      <div className={styles.previewStack}>
        <span>{secondaryLine}</span>
        <span>{node.displaySourceLabel || "No connected inputs"}</span>
      </div>
    </div>
  );
}

function NoteSurface({
  value,
  placeholder,
  editable,
  onChange,
  onBlur,
  pills,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  pills?: string[];
}) {
  return (
    <div className={cx(styles.noteSurface, styles.stickyNote)}>
      {editable ? (
        <textarea
          className={styles.noteEditor}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={onBlur}
          onPointerDown={stopPointer}
          placeholder={placeholder}
        />
      ) : (
        <div className={cx(styles.noteEditor, styles.noteReadOnly)}>{value.trim() || placeholder}</div>
      )}
      {pills && pills.length > 0 ? (
        <div className={styles.templatePillRow}>
          {pills.map((pill) => (
            <span key={pill} className={styles.templatePill}>
              {pill}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ListSheetEditor({
  settings,
  editable,
  onUpdateListColumnLabel,
  onUpdateListCell,
  onAddListColumn,
  onRemoveListColumn,
  onAddListRow,
  onRemoveListRow,
  onCommitTextEdits,
}: {
  settings: ListNodeSettings;
  editable: boolean;
  onUpdateListColumnLabel: (columnId: string, label: string) => void;
  onUpdateListCell: (rowId: string, columnId: string, value: string) => void;
  onAddListColumn: () => void;
  onRemoveListColumn: (columnId: string) => void;
  onAddListRow: (initialValues?: Record<string, string>) => string | null | void;
  onRemoveListRow: (rowId: string) => void;
  onCommitTextEdits: () => void;
}) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [draftRowValues, setDraftRowValues] = useState<Record<string, string>>({});
  const draftRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    setColumnWidths((current) => {
      const next: Record<string, number> = {};
      let changed = false;

      for (const column of settings.columns) {
        next[column.id] = current[column.id] || 160;
        if (next[column.id] !== current[column.id]) {
          changed = true;
        }
      }

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [settings.columns]);

  useEffect(() => {
    setDraftRowValues((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const column of settings.columns) {
        next[column.id] = current[column.id] || "";
        if (next[column.id] !== current[column.id]) {
          changed = true;
        }
      }

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [settings.columns]);

  const commitDraftRow = () => {
    const hasContent = Object.values(draftRowValues).some((value) => value.trim().length > 0);
    if (!hasContent) {
      return;
    }
    onAddListRow(draftRowValues);
    setDraftRowValues(
      settings.columns.reduce<Record<string, string>>((acc, column) => {
        acc[column.id] = "";
        return acc;
      }, {})
    );
    onCommitTextEdits();
  };

  const startColumnResize = (columnId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    stopPointer(event);
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnId] || 160;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setColumnWidths((current) => ({
        ...current,
        [columnId]: Math.max(132, Math.round(startWidth + delta)),
      }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    commitDraftRow();
  };

  return (
    <div className={styles.listShell}>
      {editable ? (
        <button
          type="button"
          className={styles.listFloatingAction}
          onPointerDown={stopPointer}
          onClick={onAddListColumn}
        >
          Add column
        </button>
      ) : null}
      <div className={styles.listScroller}>
        <table className={styles.listTable}>
          <colgroup>
            <col style={{ width: 58 }} />
            {settings.columns.map((column) => (
              <col key={column.id} style={{ width: columnWidths[column.id] || 160 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.listRowHead}>#</th>
              {settings.columns.map((column, index) => (
                <th key={column.id} className={styles.listHeaderCell}>
                  <div className={styles.listHeaderCellInner}>
                    <span className={styles.listColumnLetter}>{spreadsheetColumnLabel(index)}</span>
                    {editable ? (
                      <input
                        className={styles.listHeaderInput}
                        value={column.label}
                        onChange={(event) => onUpdateListColumnLabel(column.id, event.target.value)}
                        onBlur={onCommitTextEdits}
                        onPointerDown={stopPointer}
                        placeholder={`Column ${index + 1}`}
                      />
                    ) : (
                      <span className={styles.listHeaderValue}>{column.label || `Column ${index + 1}`}</span>
                    )}
                    {editable ? (
                      <button
                        type="button"
                        className={styles.listColumnRemove}
                        aria-label={`Remove ${column.label || `column ${index + 1}`}`}
                        onPointerDown={stopPointer}
                        onClick={() => onRemoveListColumn(column.id)}
                      >
                        ×
                      </button>
                    ) : null}
                    {editable ? (
                      <button
                        type="button"
                        className={styles.listColumnResizer}
                        aria-label={`Resize ${column.label || `column ${index + 1}`}`}
                        onPointerDown={(event) => startColumnResize(column.id, event)}
                      />
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settings.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                <td className={styles.listRowHead}>
                  <div className={styles.listRowHeadInner}>
                    <span>{rowIndex + 1}</span>
                    {editable ? (
                      <button
                        type="button"
                        className={styles.listRowRemove}
                        onPointerDown={stopPointer}
                        onClick={() => onRemoveListRow(row.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </td>
                {settings.columns.map((column) => (
                  <td key={`${row.id}:${column.id}`} className={styles.listCell} data-list-cell-id={`${row.id}:${column.id}`}>
                    {editable ? (
                      <input
                        className={styles.listCellInput}
                        value={row.values[column.id] || ""}
                        onChange={(event) => onUpdateListCell(row.id, column.id, event.target.value)}
                        onBlur={onCommitTextEdits}
                        onPointerDown={stopPointer}
                        placeholder="Value"
                      />
                    ) : (
                      <span className={styles.listCellValue}>{row.values[column.id] || ""}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {editable ? (
              <tr ref={draftRowRef} className={styles.listDraftRow}>
                <td className={styles.listRowHead}>
                  <span>+</span>
                </td>
                {settings.columns.map((column) => (
                  <td key={`draft:${column.id}`} className={styles.listCell}>
                    <input
                      className={cx(styles.listCellInput, styles.listDraftInput)}
                      value={draftRowValues[column.id] || ""}
                      onChange={(event) =>
                        setDraftRowValues((current) => ({
                          ...current,
                          [column.id]: event.target.value,
                        }))
                      }
                      onBlur={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (nextTarget instanceof Node && draftRowRef.current?.contains(nextTarget)) {
                          return;
                        }
                        commitDraftRow();
                      }}
                      onKeyDown={handleDraftKeyDown}
                      onPointerDown={stopPointer}
                      placeholder="Add row"
                    />
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplatePreviewBody({
  node,
  preview,
}: {
  node: CanvasRenderNode;
  preview: TextTemplatePreview | null;
}) {
  const tokens =
    (preview?.columns.length || 0) > 0
      ? (preview?.columns || []).slice(0, 4).map((column) => `[[${column.label}]]`)
      : (preview?.tokens || []).slice(0, 4).map((token) => `[[${token.label}]]`);

  return (
    <NoteSurface
      value={node.prompt}
      placeholder="Empty template"
      editable={false}
      pills={tokens}
    />
  );
}

function TemplateEditorBody({
  activeEditor,
  onPromptChange,
  onCommitTextEdits,
}: {
  activeEditor: ActiveCanvasNodeEditorState;
  onPromptChange: (value: string) => void;
  onCommitTextEdits: () => void;
}) {
  const availableColumns = activeEditor.selectedTemplateListNode
    ? activeEditor.selectedTemplatePreview?.columns || []
    : [];
  const variableChips =
    availableColumns.length > 0
      ? availableColumns.map((column) => ({
          key: column.id,
          label: column.label,
        }))
      : (activeEditor.selectedTemplatePreview?.tokens || []).map((token) => ({
          key: token.key,
          label: token.label,
        }));

  return (
    <div className={styles.templateEditorShell}>
      <div className={styles.templateVariableShelf}>
        {variableChips.map((token) => (
          <button
            key={token.key}
            type="button"
            className={styles.templateVariableButton}
            onPointerDown={stopPointer}
            onClick={() => {
              onPromptChange(`${activeEditor.selectedNode.prompt}[[${token.label}]]`);
            }}
          >
            {`[[${token.label}]]`}
          </button>
        ))}
      </div>
      <textarea
        className={styles.templateEditor}
        value={activeEditor.selectedNode.prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onBlur={onCommitTextEdits}
        onPointerDown={stopPointer}
        placeholder="Write template with [[variables]]"
      />
      <div className={styles.templateStatusStrip}>
        <span>
          {activeEditor.selectedTemplatePreview?.disabledReason ||
            activeEditor.selectedTemplatePreview?.readyMessage ||
            "Ready"}
        </span>
        <span>{`${activeEditor.selectedTemplatePreview?.nonBlankRowCount || 0} rows`}</span>
      </div>
    </div>
  );
}

function ModelEditorBody({
  node,
  activeEditor,
  pickerDismissKey,
  onPromptChange,
  onModelVariantChange,
  onParameterChange,
  onClearInputs,
  onCommitTextEdits,
}: {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  pickerDismissKey?: string | number | null;
  onPromptChange: (value: string) => void;
  onModelVariantChange: (variantId: string) => void;
  onParameterChange: (parameterKey: string, value: string | number | null) => void;
  onClearInputs: () => void;
  onCommitTextEdits: () => void;
}) {
  if (!activeEditor) {
    return <PreviewModelNode node={node} />;
  }

  const selectedVariantId = `model:${activeEditor.selectedNode.providerId}:${activeEditor.selectedNode.modelId}`;
  const summaryLines = [
    activeEditor.selectedNodeRunPreview?.readyMessage ||
      activeEditor.selectedNodeRunPreview?.disabledReason ||
      "Not ready yet",
    activeEditor.selectedNodeRunPreview?.endpoint || "No endpoint",
    `Target: ${node.outputType}`,
  ];

  return (
    <div className={styles.modelShell}>
      <div className={styles.modelGrid}>
        <section className={styles.modelPanel}>
          <div className={styles.panelHeader}>
            <strong>Inputs</strong>
          </div>
          <div className={styles.previewStack}>
            {activeEditor.selectedInputNodes.length > 0 ? (
              activeEditor.selectedInputNodes.map((inputNode) => (
                <span key={inputNode.id}>{inputNode.label}</span>
              ))
            ) : (
              <span>No connected inputs</span>
            )}
            {activeEditor.selectedPromptSourceNode ? (
              <span>{`Prompt source: ${activeEditor.selectedPromptSourceNode.label}`}</span>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.subtleButton}
            onPointerDown={stopPointer}
            onClick={onClearInputs}
          >
            Clear inputs
          </button>
        </section>

        <section className={cx(styles.modelPanel, styles.modelPromptPanel)}>
          <div className={styles.panelHeader}>
            <strong>Prompt</strong>
          </div>
          <textarea
            className={styles.modelPrompt}
            value={activeEditor.selectedNode.prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onBlur={onCommitTextEdits}
            onPointerDown={stopPointer}
            placeholder="Describe what to generate"
          />
        </section>

        <section className={styles.modelPanel}>
          <div className={styles.panelHeader}>
            <strong>Model</strong>
          </div>
          <label className={styles.fieldLabel}>
            <span>Variant</span>
            <SearchableModelSelect
              value={selectedVariantId}
              options={activeEditor.modelCatalogVariants}
              surface="canvas-overlay"
              density="compact"
              dismissKey={pickerDismissKey}
              onChange={(variant) => onModelVariantChange(variant.id)}
            />
          </label>
          <div className={styles.parameterGrid}>
            {[...activeEditor.selectedCoreParameters, ...activeEditor.selectedAdvancedParameters].map((parameter) => (
              <label key={parameter.key} className={styles.fieldLabel}>
                <span>{parameter.label}</span>
                {renderParameterField(
                  parameter,
                  activeEditor.selectedNodeResolvedSettings[parameter.key],
                  (value) => onParameterChange(parameter.key, value),
                  onCommitTextEdits
                )}
              </label>
            ))}
          </div>
        </section>

        <section className={styles.modelPanel}>
          <div className={styles.panelHeader}>
            <strong>Output</strong>
          </div>
          <div className={styles.previewStack}>
            {summaryLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function CanvasNodeContent({
  node,
  activeEditor,
  pickerDismissKey,
  onSetDisplayMode,
  onEnterEditMode,
  onExitEditMode,
  onRunNode,
  onLabelChange,
  onPromptChange,
  onModelVariantChange,
  onParameterChange,
  onUpdateListColumnLabel,
  onUpdateListCell,
  onAddListColumn,
  onRemoveListColumn,
  onAddListRow,
  onRemoveListRow,
  onClearInputs,
  onOpenAssetViewer,
  onDownloadAssets,
  onOpenQueueInspect,
  onCommitTextEdits,
}: Props) {
  const isActive = activeEditor?.nodeId === node.id;
  const editor = isActive ? activeEditor : null;
  const listSettings = editor?.selectedListSettings || (node.kind === "list" ? getListNodeSettings(node.settings) : null);
  const templatePreview =
    editor?.selectedTemplatePreview ||
    (node.kind === "text-template"
      ? {
          columns: [],
          tokens: (node.templateTokens || []).map((token) => ({
            raw: `[[${token}]]`,
            key: token,
            label: token,
          })),
          emptyColumnIds: [],
          duplicateColumnIds: [],
          rows: [],
          unresolvedTokens: [],
          nonBlankRowCount: node.listRowCount || 0,
          disabledReason: node.templateStatusMessage || null,
          readyMessage: node.templateReady ? "Ready" : null,
        }
      : null);

  const secondaryLabel =
    node.kind === "model"
      ? editor?.selectedModel?.displayName || node.displayModelName || node.modelId
      : node.kind === "asset-source"
        ? node.displaySourceLabel || node.outputType
        : node.kind;

  const actionDescriptors = getCanvasNodeActionDescriptors({
    interactionPolicy: node.presentation.interactionPolicy,
    persistedMode: node.presentation.persistedMode,
    renderMode: node.presentation.renderMode,
    isEditing: node.presentation.isEditing,
    canRun: node.kind === "text-template" ? Boolean(templatePreview && !templatePreview.disabledReason) : undefined,
    hasAsset: Boolean(editor?.selectedSingleImageAssetId),
    hasDebug: Boolean(editor?.selectedNodeSourceJobId),
  });

  const actionHandlers: NodeActionHandlerMap = {
    default: () => {
      onExitEditMode();
      onSetDisplayMode("preview");
    },
    compact: () => {
      onExitEditMode();
      onSetDisplayMode("compact");
    },
    edit: () => {
      onEnterEditMode();
    },
    run: () => {
      onRunNode();
    },
    open: () => {
      if (editor?.selectedSingleImageAssetId) {
        onOpenAssetViewer(editor.selectedSingleImageAssetId);
      }
    },
    download: () => {
      if (editor?.selectedSingleImageAssetId) {
        onDownloadAssets([editor.selectedSingleImageAssetId]);
      }
    },
    debug: () => {
      if (editor?.selectedNodeSourceJobId) {
        onOpenQueueInspect(editor.selectedNodeSourceJobId);
      }
    },
  };

  const externalBadge =
    node.kind === "asset-source" &&
    node.assetOrigin === "generated" &&
    node.displayModelName ? (
      <NodeExternalBadge align="input">{node.displayModelName}</NodeExternalBadge>
    ) : null;

  const frame = (children?: ReactNode) => (
    <NodeFrame
      node={node}
      activeEditor={editor}
      titleLabel={secondaryLabel}
      actionDescriptors={actionDescriptors}
      actionHandlers={actionHandlers}
      externalBadge={externalBadge}
      onLabelChange={onLabelChange}
      onCommitTextEdits={onCommitTextEdits}
    >
      {children}
    </NodeFrame>
  );

  if (node.presentation.renderMode === "compact") {
    return frame(<CompactNode node={node} />);
  }

  if (node.kind === "asset-source") {
    if (node.outputType === "image") {
      return frame();
    }

    return frame(
      <div className={styles.assetPreviewMeta}>
        <strong>{node.label}</strong>
        <span>{node.displaySourceLabel || node.displayModelName || node.outputType}</span>
      </div>
    );
  }

  if (node.kind === "text-note") {
    return frame(
      <NoteSurface
        value={editor ? editor.selectedNode.prompt : node.prompt}
        placeholder="Empty note"
        editable={Boolean(editor)}
        onChange={onPromptChange}
        onBlur={onCommitTextEdits}
      />
    );
  }

  if (node.kind === "list" && listSettings) {
    return frame(
      <ListSheetEditor
        settings={listSettings}
        editable={Boolean(editor)}
        onUpdateListColumnLabel={onUpdateListColumnLabel}
        onUpdateListCell={onUpdateListCell}
        onAddListColumn={onAddListColumn}
        onRemoveListColumn={onRemoveListColumn}
        onAddListRow={onAddListRow}
        onRemoveListRow={onRemoveListRow}
        onCommitTextEdits={onCommitTextEdits}
      />
    );
  }

  if (node.kind === "text-template") {
    return frame(
      node.presentation.isEditing && editor ? (
        <TemplateEditorBody
          activeEditor={editor}
          onPromptChange={onPromptChange}
          onCommitTextEdits={onCommitTextEdits}
        />
      ) : (
        <TemplatePreviewBody node={node} preview={templatePreview} />
      )
    );
  }

  if (node.kind === "model") {
    return frame(
      node.presentation.renderMode === "full" || node.presentation.renderMode === "resized" ? (
        <ModelEditorBody
          node={node}
          activeEditor={editor}
          pickerDismissKey={pickerDismissKey}
          onPromptChange={onPromptChange}
          onModelVariantChange={onModelVariantChange}
          onParameterChange={onParameterChange}
          onClearInputs={onClearInputs}
          onCommitTextEdits={onCommitTextEdits}
        />
      ) : (
        <PreviewModelNode node={node} />
      )
    );
  }

  return frame();
}
