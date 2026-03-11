"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
import {
  getCanvasNodeActionDescriptors,
  type CanvasNodeActionDescriptor,
} from "@/lib/canvas-node-actions";
import {
  buildTemplateVariableInsertText,
  getListNodeSettings,
  getTemplateVariableDisplayLabel,
} from "@/lib/list-template";
import { getCanvasNodeTitleChip, type CanvasNodeTitleChip } from "@/lib/canvas-node-title-chip";
import type { TextTemplatePreview } from "@/lib/list-template";
import type { ModelParameterDefinition } from "@/lib/model-parameters";
import { getModelPromptSurfaceState } from "@/lib/model-node-editor";
import type { NodeCatalogVariant } from "@/lib/node-catalog";
import { tokenizeTemplatePreviewInline } from "@/lib/template-preview-inline";
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

export type CanvasModelEditorState = Pick<
  ActiveCanvasNodeEditorState,
  | "selectedNode"
  | "selectedModel"
  | "selectedNodeResolvedSettings"
  | "selectedCoreParameters"
  | "selectedAdvancedParameters"
  | "selectedInputNodes"
  | "selectedPromptSourceNode"
  | "modelCatalogVariants"
>;

type Props = {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  passiveModelEditor?: CanvasModelEditorState | null;
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
  onDuplicateNode: () => void;
  onOpenAssetViewer: (assetId: string) => void;
  onDownloadAssets: (assetIds: string[]) => void;
  onOpenQueueInspect: (jobId: string) => void;
  onCommitTextEdits: () => void;
};

type NodeActionHandlerMap = Record<string, () => void>;
type NodeFooterAlign = "center" | "start";
type NodeFooterSpacing = "default" | "tight";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type TemplateVariableChip = {
  key: string;
  label: string;
};

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function renderParameterField(
  definition: ModelParameterDefinition,
  value: unknown,
  interactive: boolean,
  onChange: (value: string | number | null) => void,
  onBlur: () => void
) {
  if (!interactive) {
    const textValue =
      definition.control === "select"
        ? (definition.options || []).find((option) => option.value === value)?.label || definition.placeholder || "Unset"
        : value === null || value === undefined || value === ""
          ? definition.placeholder || "Unset"
          : String(value);

    return (
      <div
        className={cx(
          styles.fieldControl,
          styles.fieldControlReadOnly,
          definition.control === "textarea" && styles.fieldControlTextarea
        )}
        data-control="readonly"
      >
        {textValue}
      </div>
    );
  }

  if (definition.control === "select") {
    return (
      <select
        className={styles.fieldControl}
        data-control="select"
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
        data-control="input"
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
        data-control="textarea"
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
      data-control="input"
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
  titleChip,
  onLabelChange,
  onCommitTextEdits,
}: {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  titleChip: CanvasNodeTitleChip | null;
  onLabelChange: (value: string) => void;
  onCommitTextEdits: () => void;
}) {
  const titleChipStyle = titleChip
    ? ({
        "--title-meta-pill-background": titleChip.color,
      } as CSSProperties)
    : undefined;

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
        {titleChip ? (
          <span className={styles.titleMetaPillRail}>
            <span className={styles.titleMetaPill} style={titleChipStyle}>
              <span className={styles.titleMetaPillText}>{titleChip.label}</span>
            </span>
          </span>
        ) : (
          <span className={styles.titleMeta}>{node.kind}</span>
        )}
      </div>
    </div>
  );
}

function DragPill() {
  return (
    <span className={styles.dragPill} data-node-drag-handle="true">
      Drag me
    </span>
  );
}

function NodeTopUtilities({ children }: { children?: ReactNode }) {
  if (!children) {
    return null;
  }

  return <>{children}</>;
}

function NodeUtilityPillRail({
  descriptors,
  handlers,
}: {
  descriptors: CanvasNodeActionDescriptor[];
  handlers: NodeActionHandlerMap;
}) {
  if (descriptors.length === 0) {
    return null;
  }

  return (
    <div className={styles.utilityPillRail}>
      {descriptors.map((descriptor) => (
        <button
          key={descriptor.id}
          type="button"
          className={styles.utilityPillButton}
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

function NodeActionRail({
  descriptors,
  handlers,
  align = "center",
}: {
  descriptors: ReturnType<typeof getCanvasNodeActionDescriptors>;
  handlers: NodeActionHandlerMap;
  align?: NodeFooterAlign;
}) {
  if (descriptors.length === 0) {
    return null;
  }

  return (
    <div className={cx(styles.actionRail, align === "start" && styles.actionRailStart)}>
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

function NodeFooterRail({
  caption,
  actionDescriptors,
  actionHandlers,
  align = "center",
  spacing = "default",
}: {
  caption?: ReactNode;
  actionDescriptors: ReturnType<typeof getCanvasNodeActionDescriptors>;
  actionHandlers: NodeActionHandlerMap;
  align?: NodeFooterAlign;
  spacing?: NodeFooterSpacing;
}) {
  if (!caption && actionDescriptors.length === 0) {
    return null;
  }

  return (
    <div
      className={cx(
        styles.footerRail,
        align === "start" ? styles.footerRailStart : styles.footerRailCenter,
        spacing === "tight" && styles.footerRailTight
      )}
    >
      {caption ? <div className={styles.footerCaption}>{caption}</div> : null}
      <NodeActionRail descriptors={actionDescriptors} handlers={actionHandlers} align={align} />
    </div>
  );
}

function NodeFrame({
  node,
  activeEditor,
  titleChip,
  actionDescriptors,
  actionHandlers,
  hideTitleRail = false,
  topUtility,
  footerCaption,
  footerAlign = "center",
  footerSpacing = "default",
  onLabelChange,
  onCommitTextEdits,
  children,
}: {
  node: CanvasRenderNode;
  activeEditor: ActiveCanvasNodeEditorState | null;
  titleChip: CanvasNodeTitleChip | null;
  actionDescriptors: ReturnType<typeof getCanvasNodeActionDescriptors>;
  actionHandlers: NodeActionHandlerMap;
  hideTitleRail?: boolean;
  topUtility?: ReactNode;
  footerCaption?: ReactNode;
  footerAlign?: NodeFooterAlign;
  footerSpacing?: NodeFooterSpacing;
  onLabelChange: (value: string) => void;
  onCommitTextEdits: () => void;
  children?: ReactNode;
}) {
  const showTitleRail = node.presentation.showTitleRail && !hideTitleRail;
  const showDragPill = node.presentation.useRailDragHandle;
  const topLeftActionDescriptors = actionDescriptors.filter((descriptor) => descriptor.slot === "top-left");
  const bottomActionDescriptors = actionDescriptors.filter((descriptor) => descriptor.slot === "bottom");
  const leftUtilities =
    topLeftActionDescriptors.length > 0
      ? <NodeTopUtilities><NodeUtilityPillRail descriptors={topLeftActionDescriptors} handlers={actionHandlers} /></NodeTopUtilities>
      : null;
  const topUtilities = (topUtility || showDragPill) ? (
    <NodeTopUtilities>
      {topUtility}
      {showDragPill ? <DragPill /> : null}
    </NodeTopUtilities>
  ) : null;
  const showTopBar = node.presentation.showTitleRail;

  return (
    <div
      className={styles.nodeChrome}
      data-kind={node.kind}
      data-render-mode={node.presentation.renderMode}
      data-active={node.presentation.isExpanded ? "true" : "false"}
      data-editing={node.presentation.isEditing ? "true" : "false"}
    >
      {showTopBar ? (
        <div className={styles.topBar}>
          <div className={cx(styles.topBarSection, styles.topBarSectionStart)}>{leftUtilities}</div>
          <div className={cx(styles.topBarSection, styles.topBarSectionCenter)}>
            {showTitleRail ? (
              <NodeTitleRail
                node={node}
                activeEditor={activeEditor}
                titleChip={titleChip}
                onLabelChange={onLabelChange}
                onCommitTextEdits={onCommitTextEdits}
              />
            ) : null}
          </div>
          <div className={cx(styles.topBarSection, styles.topBarSectionEnd)}>{topUtilities}</div>
        </div>
      ) : null}
      {children ? <div className={styles.nodeViewport}>{children}</div> : null}
      <NodeFooterRail
        caption={footerCaption}
        actionDescriptors={node.presentation.showActionRail ? bottomActionDescriptors : []}
        actionHandlers={actionHandlers}
        align={footerAlign}
        spacing={footerSpacing}
      />
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

function InlineTemplatePreviewText({
  value,
  placeholder,
}: {
  value: string;
  placeholder: string;
}) {
  const parts = tokenizeTemplatePreviewInline(value);

  if (parts.length === 0) {
    return <div className={cx(styles.noteEditor, styles.noteReadOnly)}>{placeholder}</div>;
  }

  return (
    <div className={cx(styles.noteEditor, styles.noteReadOnly, styles.templatePreviewText)}>
      {parts.map((part, index) =>
        part.type === "token" ? (
          <span key={`${part.raw}:${index}`} className={styles.inlineTemplatePill}>
            {getTemplateVariableDisplayLabel(part.value)}
          </span>
        ) : (
          <span key={`${part.value}:${index}`}>{part.value}</span>
        )
      )}
    </div>
  );
}

function TemplateVariablePillList({
  tokens,
  interactive = false,
  onSelect,
  className,
}: {
  tokens: TemplateVariableChip[];
  interactive?: boolean;
  onSelect?: (token: TemplateVariableChip) => void;
  className?: string;
}) {
  const visibleTokens = tokens
    .map((token) => ({
      ...token,
      displayLabel: getTemplateVariableDisplayLabel(token.label),
    }))
    .filter((token) => token.displayLabel.length > 0);

  if (visibleTokens.length === 0) {
    return null;
  }

  return (
    <div className={cx(styles.templateVariableShelf, className)}>
      {visibleTokens.map((token) =>
        interactive ? (
          <button
            key={token.key}
            type="button"
            className={styles.templateVariableButton}
            onPointerDown={stopPointer}
            onClick={() => onSelect?.(token)}
          >
            {token.displayLabel}
          </button>
        ) : (
          <span key={token.key} className={styles.templatePill}>
            {token.displayLabel}
          </span>
        )
      )}
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
  previewContent,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  previewContent?: ReactNode;
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
        previewContent || <div className={cx(styles.noteEditor, styles.noteReadOnly)}>{value.trim() || placeholder}</div>
      )}
    </div>
  );
}

function ListSheetEditor({
  settings,
  editable,
  onUpdateListColumnLabel,
  onUpdateListCell,
  onRemoveListColumn,
  onAddListRow,
  onRemoveListRow,
  onCommitTextEdits,
}: {
  settings: ListNodeSettings;
  editable: boolean;
  onUpdateListColumnLabel: (columnId: string, label: string) => void;
  onUpdateListCell: (rowId: string, columnId: string, value: string) => void;
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
      <div className={styles.listScroller}>
        <table className={styles.listTable}>
          <colgroup>
            <col style={{ width: 42 }} />
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
                  <div className={styles.listRowHeadInner}>
                    <span>+</span>
                  </div>
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
}: {
  node: CanvasRenderNode;
}) {
  return (
    <NoteSurface
      value={node.prompt}
      placeholder="Empty template"
      editable={false}
      previewContent={
        <InlineTemplatePreviewText
          value={node.prompt}
          placeholder="Empty template"
        />
      }
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
  const unresolvedTokens = (activeEditor.selectedTemplatePreview?.unresolvedTokens || []).map((token) => ({
    key: token.key,
    label: token.label,
  }));
  const statusMessage =
    unresolvedTokens.length > 0
      ? "Add columns for the missing variables."
      : activeEditor.selectedTemplatePreview?.disabledReason || activeEditor.selectedTemplatePreview?.readyMessage || "Ready";

  return (
    <div className={styles.templateEditorShell}>
      <TemplateVariablePillList
        tokens={variableChips}
        interactive
        onSelect={(token) => {
          const insertText = buildTemplateVariableInsertText(token.label);
          if (!insertText) {
            return;
          }
          onPromptChange(`${activeEditor.selectedNode.prompt}${insertText}`);
        }}
      />
      <textarea
        className={styles.templateEditor}
        value={activeEditor.selectedNode.prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onBlur={onCommitTextEdits}
        onPointerDown={stopPointer}
        placeholder="Write template with [[variables]]"
      />
      <div className={styles.templateStatusArea}>
        <div className={styles.templateStatusStrip}>
          <span>{statusMessage}</span>
          <span>{`${activeEditor.selectedTemplatePreview?.nonBlankRowCount || 0} rows`}</span>
        </div>
        {unresolvedTokens.length > 0 ? (
          <TemplateVariablePillList
            tokens={unresolvedTokens}
            className={styles.templateMissingVariableShelf}
          />
        ) : null}
      </div>
    </div>
  );
}

function ModelEditorBody({
  node,
  editorState,
  interactive,
  pickerDismissKey,
  onPromptChange,
  onModelVariantChange,
  onParameterChange,
  onClearInputs,
  onCommitTextEdits,
}: {
  node: CanvasRenderNode;
  editorState: CanvasModelEditorState | null;
  interactive: boolean;
  pickerDismissKey?: string | number | null;
  onPromptChange: (value: string) => void;
  onModelVariantChange: (variantId: string) => void;
  onParameterChange: (parameterKey: string, value: string | number | null) => void;
  onClearInputs: () => void;
  onCommitTextEdits: () => void;
}) {
  if (!editorState) {
    return <PreviewModelNode node={node} />;
  }

  const selectedVariantId = `model:${editorState.selectedNode.providerId}:${editorState.selectedNode.modelId}`;
  const selectedVariant =
    editorState.modelCatalogVariants.find((variant) => variant.id === selectedVariantId) || null;
  const promptSurface = getModelPromptSurfaceState({
    prompt: editorState.selectedNode.prompt,
    promptSourceNode: editorState.selectedPromptSourceNode,
  });
  const hasConnectedInputs =
    editorState.selectedInputNodes.length > 0 || Boolean(editorState.selectedPromptSourceNode);
  const showClearInputs = hasConnectedInputs && interactive;
  const visibleParameters = [...editorState.selectedCoreParameters, ...editorState.selectedAdvancedParameters];
  const promptValue = promptSurface.value.trim() || promptSurface.placeholder;

  return (
    <div className={styles.modelShell}>
      <div className={styles.modelGrid}>
        <section className={cx(styles.modelPanel, styles.modelPromptPanel)}>
          <div className={cx(styles.panelHeader, showClearInputs && styles.panelHeaderWithAction)}>
            {showClearInputs ? <span className={styles.panelHeaderSpacer} aria-hidden="true" /> : null}
            <strong className={cx(styles.panelTitle, promptSurface.isConnectedPreview && styles.panelHeaderAccent)}>
              {promptSurface.title}
            </strong>
            {showClearInputs ? (
              <button
                type="button"
                className={styles.panelClearButton}
                onPointerDown={stopPointer}
                onClick={onClearInputs}
              >
                Clear inputs
              </button>
            ) : null}
          </div>
          {promptSurface.readOnly || !interactive ? (
            <div
              className={cx(
                styles.modelPrompt,
                styles.modelPromptReadOnly,
                promptSurface.isConnectedPreview && styles.modelPromptConnected,
                !promptSurface.value.trim() && styles.modelPromptPlaceholder
              )}
            >
              {promptValue}
            </div>
          ) : (
            <textarea
              className={styles.modelPrompt}
              value={editorState.selectedNode.prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={onCommitTextEdits}
              onPointerDown={stopPointer}
              placeholder={promptSurface.placeholder}
            />
          )}
        </section>

        <section className={styles.modelPanel}>
          <div className={cx(styles.panelHeader, styles.panelHeaderCentered)}>
            <strong className={styles.panelTitle}>Model Settings</strong>
          </div>
          {interactive ? (
            <SearchableModelSelect
              value={selectedVariantId}
              options={editorState.modelCatalogVariants}
              surface="canvas-overlay"
              density="compact"
              triggerTone="model-node"
              dismissKey={pickerDismissKey}
              onChange={(variant) => onModelVariantChange(variant.id)}
            />
          ) : (
            <div className={cx(styles.fieldControl, styles.fieldControlReadOnly, styles.modelSelectReadOnly)}>
              <strong>
                {selectedVariant
                  ? `${selectedVariant.providerLabel} · ${selectedVariant.label}`
                  : editorState.selectedModel?.displayName || node.displayModelName || node.modelId}
              </strong>
              <span>
                {selectedVariant
                  ? `${selectedVariant.modelId} · ${selectedVariant.availabilityLabel}`
                  : editorState.selectedNode.modelId}
              </span>
            </div>
          )}
          <div className={styles.parameterGrid}>
            {visibleParameters.map((parameter) => (
              <label key={parameter.key} className={styles.fieldLabel}>
                <span className={styles.fieldLabelText}>{parameter.label}</span>
                {renderParameterField(
                  parameter,
                  editorState.selectedNodeResolvedSettings[parameter.key],
                  interactive,
                  (value) => onParameterChange(parameter.key, value),
                  onCommitTextEdits
                )}
              </label>
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
  passiveModelEditor = null,
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
  onDuplicateNode,
  onOpenAssetViewer,
  onDownloadAssets,
  onOpenQueueInspect,
  onCommitTextEdits,
}: Props) {
  const isActive = activeEditor?.nodeId === node.id;
  const editor = isActive ? activeEditor : null;
  const modelEditor = node.kind === "model" ? editor || passiveModelEditor : null;
  const listSettings = editor?.selectedListSettings || (node.kind === "list" ? getListNodeSettings(node.settings) : null);
  const isImageAssetNode = node.kind === "asset-source" && node.outputType === "image";
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

  const titleChip = getCanvasNodeTitleChip({
    kind: node.kind,
    assetOrigin: node.assetOrigin,
    outputType: node.outputType,
    displayModelName: node.kind === "model" ? (editor?.selectedModel?.displayName || node.displayModelName || null) : null,
    modelId: node.modelId,
  });

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
    "add-column": () => {
      onAddListColumn();
    },
    debug: () => {
      if (editor?.selectedNodeSourceJobId) {
        onOpenQueueInspect(editor.selectedNodeSourceJobId);
      }
    },
    duplicate: () => {
      onDuplicateNode();
    },
  };

  const topUtility =
    isImageAssetNode && node.processingState ? (
      <span className={styles.statusBubble} data-state={node.processingState}>
        {node.processingState}
      </span>
    ) : null;

  const footerCaption = null;

  const frame = (children?: ReactNode) => (
    <NodeFrame
      node={node}
      activeEditor={editor}
      titleChip={titleChip}
      actionDescriptors={actionDescriptors}
      actionHandlers={actionHandlers}
      topUtility={topUtility}
      footerCaption={footerCaption}
      footerAlign={isImageAssetNode ? "start" : "center"}
      footerSpacing={isImageAssetNode ? "tight" : "default"}
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
        <TemplatePreviewBody node={node} />
      )
    );
  }

  if (node.kind === "model") {
    return frame(
      node.presentation.renderMode === "full" || node.presentation.renderMode === "resized" ? (
        <ModelEditorBody
          node={node}
          editorState={modelEditor}
          interactive={Boolean(editor)}
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
