import type {
  GeneratedTextNoteSettings,
  ListColumn,
  ListNodeSettings,
  ListRow,
  TextNoteSettings,
  TextTemplateNodeSettings,
  WorkflowNode,
} from "@/components/workspace/types";

export const LIST_NODE_SOURCE = "list";
export const TEXT_TEMPLATE_SOURCE = "text-template";
export const TEXT_NOTE_SOURCE = "text-note";
export const TEMPLATE_OUTPUT_SOURCE = "template-output";

const whitespacePattern = /\s+/g;
const placeholderPattern = /\[\[\s*([^[\]]+?)\s*\]\]/g;

export type TemplateToken = {
  raw: string;
  label: string;
  key: string;
};

export type NormalizedListColumn = ListColumn & {
  normalizedLabel: string;
};

export type TemplatePreviewRow = {
  rowId: string;
  rowIndex: number;
  text: string;
};

export type TextTemplatePreview = {
  columns: NormalizedListColumn[];
  tokens: TemplateToken[];
  unresolvedTokens: TemplateToken[];
  emptyColumnIds: string[];
  duplicateColumnIds: string[];
  rows: TemplatePreviewRow[];
  nonBlankRowCount: number;
  disabledReason: string | null;
  readyMessage: string | null;
};

function nextLocalId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function normalizeTemplateLabel(value: string) {
  return value.trim().replace(whitespacePattern, " ").toLowerCase();
}

export function normalizeTemplateDisplayLabel(value: string) {
  return value.trim().replace(whitespacePattern, " ");
}

export function createListColumn(label = "", id = nextLocalId("col")): ListColumn {
  return {
    id,
    label,
  };
}

export function createListRow(columnIds: string[] = [], values: Record<string, string> = {}, id = nextLocalId("row")): ListRow {
  const nextValues = columnIds.reduce<Record<string, string>>((acc, columnId) => {
    acc[columnId] = String(values[columnId] ?? "");
    return acc;
  }, {});

  return {
    id,
    values: nextValues,
  };
}

export function createDefaultListNodeSettings(): ListNodeSettings {
  const firstColumn = createListColumn("Column 1");
  return {
    source: LIST_NODE_SOURCE,
    columns: [firstColumn],
    rows: [createListRow([firstColumn.id])],
  };
}

export function createTextTemplateNodeSettings(): TextTemplateNodeSettings {
  return {
    source: TEXT_TEMPLATE_SOURCE,
  };
}

export function createTextNoteSettings(): TextNoteSettings {
  return {
    source: TEXT_NOTE_SOURCE,
  };
}

export function createGeneratedTextNoteSettings(input: Omit<GeneratedTextNoteSettings, "source">): GeneratedTextNoteSettings {
  return {
    source: TEMPLATE_OUTPUT_SOURCE,
    ...input,
  };
}

export function getListNodeSettings(value: unknown): ListNodeSettings {
  const record = asRecord(value);
  const columns = Array.isArray(record.columns)
    ? record.columns
        .map((column, index) => {
          const item = asRecord(column);
          return {
            id: item.id ? String(item.id) : nextLocalId(`col-${index + 1}`),
            label: String(item.label ?? ""),
          };
        })
        .filter((column) => Boolean(column.id))
    : [];
  const columnIds = new Set(columns.map((column) => column.id));
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((row, index) => {
          const item = asRecord(row);
          const valuesRecord = asRecord(item.values);
          const values = columns.reduce<Record<string, string>>((acc, column) => {
            acc[column.id] = String(valuesRecord[column.id] ?? "");
            return acc;
          }, {});

          Object.keys(valuesRecord).forEach((columnId) => {
            if (!columnIds.has(columnId)) {
              return;
            }
            values[columnId] = String(valuesRecord[columnId] ?? "");
          });

          return {
            id: item.id ? String(item.id) : nextLocalId(`row-${index + 1}`),
            values,
          };
        })
        .filter((row) => Boolean(row.id))
    : [];

  return {
    source: LIST_NODE_SOURCE,
    columns,
    rows,
  };
}

export function getTextTemplateNodeSettings(value: unknown): TextTemplateNodeSettings {
  const record = asRecord(value);
  return {
    source: record.source === TEXT_TEMPLATE_SOURCE ? TEXT_TEMPLATE_SOURCE : TEXT_TEMPLATE_SOURCE,
  };
}

export function getGeneratedTextNoteSettings(value: unknown): GeneratedTextNoteSettings | null {
  const record = asRecord(value);
  if (
    record.source !== TEMPLATE_OUTPUT_SOURCE ||
    !record.sourceTemplateNodeId ||
    !record.sourceListNodeId ||
    !record.batchId ||
    !record.rowId ||
    typeof record.rowIndex !== "number"
  ) {
    return null;
  }

  return {
    source: TEMPLATE_OUTPUT_SOURCE,
    sourceTemplateNodeId: String(record.sourceTemplateNodeId),
    sourceListNodeId: String(record.sourceListNodeId),
    batchId: String(record.batchId),
    rowId: String(record.rowId),
    rowIndex: Number(record.rowIndex),
  };
}

export function isGeneratedTextNoteNode(node: WorkflowNode | null | undefined) {
  return node?.kind === "text-note" && Boolean(getGeneratedTextNoteSettings(node.settings));
}

export function getNormalizedListColumns(settings: ListNodeSettings): NormalizedListColumn[] {
  return settings.columns.map((column) => ({
    ...column,
    normalizedLabel: normalizeTemplateLabel(column.label),
  }));
}

export function extractTemplateTokens(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  const seenKeys = new Set<string>();
  placeholderPattern.lastIndex = 0;

  let match = placeholderPattern.exec(template);
  while (match) {
    const label = normalizeTemplateDisplayLabel(String(match[1] ?? ""));
    const key = normalizeTemplateLabel(label);

    if (label && key && !seenKeys.has(key)) {
      seenKeys.add(key);
      tokens.push({
        raw: match[0],
        label,
        key,
      });
    }

    match = placeholderPattern.exec(template);
  }

  return tokens;
}

function hasNonBlankValue(row: ListRow, columns: ListColumn[]) {
  return columns.some((column) => String(row.values[column.id] ?? "").trim().length > 0);
}

function getDuplicateColumnIds(columns: NormalizedListColumn[]) {
  const counts = columns.reduce<Map<string, number>>((acc, column) => {
    if (!column.normalizedLabel) {
      return acc;
    }
    acc.set(column.normalizedLabel, (acc.get(column.normalizedLabel) || 0) + 1);
    return acc;
  }, new Map());

  return columns
    .filter((column) => Boolean(column.normalizedLabel) && (counts.get(column.normalizedLabel) || 0) > 1)
    .map((column) => column.id);
}

function renderTemplateRow(template: string, columns: NormalizedListColumn[], row: ListRow) {
  const valuesByKey = columns.reduce<Map<string, string>>((acc, column) => {
    if (!column.normalizedLabel || acc.has(column.normalizedLabel)) {
      return acc;
    }

    acc.set(column.normalizedLabel, String(row.values[column.id] ?? ""));
    return acc;
  }, new Map());

  placeholderPattern.lastIndex = 0;
  return template.replace(placeholderPattern, (_match, rawLabel: string) => {
    const label = normalizeTemplateDisplayLabel(String(rawLabel ?? ""));
    const key = normalizeTemplateLabel(label);
    return valuesByKey.get(key) ?? "";
  });
}

export function buildTextTemplatePreview(template: string, settings: ListNodeSettings | null): TextTemplatePreview {
  const columns = settings ? getNormalizedListColumns(settings) : [];
  const tokens = extractTemplateTokens(template);
  const emptyColumnIds = columns.filter((column) => !column.normalizedLabel).map((column) => column.id);
  const duplicateColumnIds = getDuplicateColumnIds(columns);
  const duplicateKeys = new Set(
    columns
      .filter((column) => duplicateColumnIds.includes(column.id))
      .map((column) => column.normalizedLabel)
      .filter(Boolean)
  );
  const validColumnKeys = new Set(
    columns
      .filter((column) => column.normalizedLabel && !duplicateKeys.has(column.normalizedLabel))
      .map((column) => column.normalizedLabel)
  );
  const unresolvedTokens = tokens.filter((token) => !validColumnKeys.has(token.key));
  const rows = settings
    ? settings.rows.reduce<TemplatePreviewRow[]>((acc, row, rowIndex) => {
        if (!hasNonBlankValue(row, settings.columns)) {
          return acc;
        }

        acc.push({
          rowId: row.id,
          rowIndex,
          text: renderTemplateRow(template, columns, row),
        });
        return acc;
      }, [])
    : [];

  let disabledReason: string | null = null;
  if (!settings) {
    disabledReason = "Connect a list to generate rows.";
  } else if (columns.length === 0) {
    disabledReason = "Add at least one named column.";
  } else if (emptyColumnIds.length > 0) {
    disabledReason = "Name every column before generating.";
  } else if (duplicateColumnIds.length > 0) {
    disabledReason = "Column names must be unique.";
  } else if (!template.trim()) {
    disabledReason = "Write template text to generate rows.";
  } else if (unresolvedTokens.length > 0) {
    disabledReason = `Add columns for: ${unresolvedTokens.map((token) => token.label).join(", ")}.`;
  } else if (rows.length === 0) {
    disabledReason = "Add at least one non-empty row.";
  }

  return {
    columns,
    tokens,
    unresolvedTokens,
    emptyColumnIds,
    duplicateColumnIds,
    rows,
    nonBlankRowCount: rows.length,
    disabledReason,
    readyMessage:
      disabledReason === null ? `Ready to generate ${rows.length} text note${rows.length === 1 ? "" : "s"}.` : null,
  };
}
