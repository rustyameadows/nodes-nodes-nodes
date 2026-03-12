import type { CanvasConnection, CanvasRenderNode } from "@/components/canvas-node-types";
import { getCanvasNodeAccentColor, resolveCanvasNodeBorderSemantics } from "@/lib/canvas-node-design-system";

export type CanvasExportRenderableNode = {
  node: CanvasRenderNode;
  x: number;
  y: number;
  width: number;
  height: number;
  hasConnectedOutput: boolean;
  previewImageDataUrl?: string | null;
};

export type CanvasExportRenderableEdge = Pick<CanvasConnection, "id" | "semanticType" | "lineStyle"> & {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type BuildCanvasExportSvgInput = {
  width: number;
  height: number;
  nodes: CanvasExportRenderableNode[];
  edges: CanvasExportRenderableEdge[];
};

const EXPORT_FONT_FAMILY = `'SF Pro Display', 'SF Pro Text', 'Segoe UI', sans-serif`;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function curvePath(startX: number, startY: number, endX: number, endY: number) {
  const controlOffset = Math.max(48, Math.abs(endX - startX) * 0.46);
  return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

function wrapText(text: string, maxChars: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxChars) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word.slice(0, Math.max(1, maxChars - 1)));
      currentLine = word.length > maxChars ? `${word.slice(Math.max(1, maxChars - 1))}` : "";
    }

    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (words.join(" ").length > lines.join(" ").length && lines.length > 0) {
    const lastLine = lines[lines.length - 1]!;
    if (!lastLine.endsWith("...")) {
      lines[lines.length - 1] = `${lastLine.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
    }
  }

  return lines;
}

function getNodeOutputAccentType(node: CanvasRenderNode) {
  return node.kind === "model" ? "citrus" : node.outputSemanticType || node.outputType;
}

function getNodeKindLabel(node: CanvasRenderNode) {
  if (node.kind === "text-note") {
    return "Text Note";
  }
  if (node.kind === "text-template") {
    return "Template";
  }
  if (node.kind === "asset-source") {
    return node.assetOrigin === "generated" ? "Generated Asset" : "Asset";
  }
  if (node.kind === "list") {
    return "List / Sheet";
  }
  if (node.kind === "model") {
    return "Model";
  }
  return node.kind;
}

function getNodeSummary(node: CanvasRenderNode, width: number) {
  const maxChars = Math.max(14, Math.floor((width - 56) / 8));

  if (node.kind === "list") {
    return wrapText(
      `${node.listColumnCount || node.listPreviewColumns?.length || 0} columns • ${node.listRowCount || node.listPreviewRows?.length || 0} rows`,
      maxChars,
      2
    );
  }

  if (node.kind === "text-template") {
    return wrapText(node.prompt || node.templateStatusMessage || "Template node", maxChars, 3);
  }

  if (node.kind === "model") {
    const body = node.prompt || node.displayModelName || node.modelId;
    return wrapText(body, maxChars, 3);
  }

  if (node.kind === "asset-source") {
    return wrapText(node.displaySourceLabel || node.label, maxChars, 2);
  }

  return wrapText(node.prompt || node.label, maxChars, 4);
}

function renderTextLines(lines: string[], x: number, y: number, lineHeight: number, fill = "#e6edf6") {
  return lines
    .map((line, index) => {
      return `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="13" font-family="${EXPORT_FONT_FAMILY}" font-weight="500">${escapeXml(line)}</text>`;
    })
    .join("");
}

function renderListTable(nodeEntry: CanvasExportRenderableNode, bodyX: number, bodyY: number, bodyWidth: number, bodyHeight: number) {
  const columns = nodeEntry.node.listPreviewColumns || [];
  const rows = nodeEntry.node.listPreviewRows || [];
  if (columns.length === 0 || rows.length === 0 || bodyHeight < 64) {
    return "";
  }

  const maxColumns = Math.max(1, Math.min(3, columns.length));
  const maxRows = Math.max(1, Math.min(3, rows.length));
  const columnWidth = bodyWidth / maxColumns;
  const headerHeight = 22;
  const rowHeight = Math.max(20, Math.min(28, (bodyHeight - headerHeight) / maxRows));
  const cells: string[] = [];

  cells.push(
    `<rect x="${bodyX}" y="${bodyY}" width="${bodyWidth}" height="${headerHeight + rowHeight * maxRows}" rx="14" fill="#0d141a" stroke="rgba(255,255,255,0.05)" />`
  );

  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const columnX = bodyX + columnIndex * columnWidth;
    if (columnIndex > 0) {
      cells.push(
        `<line x1="${columnX}" y1="${bodyY}" x2="${columnX}" y2="${bodyY + headerHeight + rowHeight * maxRows}" stroke="rgba(255,255,255,0.06)" />`
      );
    }
    cells.push(
      `<text x="${columnX + 10}" y="${bodyY + 15}" fill="#f5f9ff" font-size="11" font-family="${EXPORT_FONT_FAMILY}" font-weight="700">${escapeXml(columns[columnIndex] || "")}</text>`
    );
  }

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const rowY = bodyY + headerHeight + rowIndex * rowHeight;
    if (rowIndex > 0) {
      cells.push(
        `<line x1="${bodyX}" y1="${rowY}" x2="${bodyX + bodyWidth}" y2="${rowY}" stroke="rgba(255,255,255,0.05)" />`
      );
    }
    for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
      const columnX = bodyX + columnIndex * columnWidth;
      const value = rows[rowIndex]?.[columnIndex] || "";
      cells.push(
        `<text x="${columnX + 10}" y="${rowY + 15}" fill="#b3c3d6" font-size="11" font-family="${EXPORT_FONT_FAMILY}" font-weight="500">${escapeXml(
          value.length > 18 ? `${value.slice(0, 15)}...` : value
        )}</text>`
      );
    }
  }

  return cells.join("");
}

function renderNodeCard(nodeEntry: CanvasExportRenderableNode) {
  const { node, x, y, width, height, previewImageDataUrl, hasConnectedOutput } = nodeEntry;
  const radius = Math.max(16, Math.min(26, Math.round(Math.min(width, height) * 0.12)));
  const paddingX = Math.max(14, Math.min(20, Math.round(width * 0.07)));
  const paddingY = Math.max(12, Math.min(18, Math.round(height * 0.06)));
  const railWidth = 6;
  const titleHeight = Math.max(34, Math.min(44, Math.round(height * 0.22)));
  const bodyX = x + paddingX;
  const bodyY = y + titleHeight + 10;
  const bodyWidth = Math.max(24, width - paddingX * 2);
  const bodyHeight = Math.max(24, height - titleHeight - paddingY - 10);
  const titleWidth = Math.max(16, width - paddingX * 2 - 92);
  const titleChars = Math.max(10, Math.floor(titleWidth / 8));
  const title = node.label.length > titleChars ? `${node.label.slice(0, Math.max(0, titleChars - 1))}…` : node.label;
  const meta = node.kind === "model" ? node.displayModelName || node.modelId : getNodeKindLabel(node);
  const metaChars = Math.max(10, Math.floor((width - paddingX * 2) / 9));
  const metaLabel = meta.length > metaChars ? `${meta.slice(0, Math.max(0, metaChars - 1))}…` : meta;
  const outputAccentType = getNodeOutputAccentType(node);
  const borderSemantics = resolveCanvasNodeBorderSemantics({
    kind: node.kind,
    assetOrigin: node.assetOrigin,
    outputAccentType,
    inputAccentTypes: node.inputSemanticTypes,
    generatedProvenance: node.generatedProvenance,
    processingState: node.processingState,
    hasConnectedOutput,
  });
  const leftAccentColor = getCanvasNodeAccentColor(
    borderSemantics.leftAccentTypes[0] || borderSemantics.fallbackLeftAccentType
  );
  const rightAccentColor = getCanvasNodeAccentColor(borderSemantics.rightAccentType);
  const summaryLines = getNodeSummary(node, width);
  const imageClipId = `export-image-clip-${escapeXml(node.id)}`;
  const imageHeight = Math.max(48, bodyHeight - 30);
  const showImage = Boolean(previewImageDataUrl) && imageHeight >= 54;
  const textBlockY = bodyY + 18;
  const statusLabel =
    node.processingState === "queued"
      ? "Queued"
      : node.processingState === "running"
        ? "Running"
        : node.processingState === "failed"
          ? "Failed"
          : null;
  const statusFill =
    node.processingState === "failed"
      ? "#ff6a5b"
      : node.processingState === "running"
        ? "#8ee59f"
        : node.processingState === "queued"
          ? "#ffd26f"
          : "#8291a5";

  return `
    <g>
      <rect x="${x}" y="${y + 10}" width="${width}" height="${height}" rx="${radius}" fill="rgba(0,0,0,0.28)" />
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="#111820" stroke="rgba(255,255,255,0.1)" />
      <rect x="${x}" y="${y}" width="${railWidth}" height="${height}" rx="${Math.max(8, radius - 6)}" fill="${leftAccentColor}" />
      <rect x="${x + width - railWidth}" y="${y}" width="${railWidth}" height="${height}" rx="${Math.max(8, radius - 6)}" fill="${rightAccentColor}" />
      <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${titleHeight}" rx="${Math.max(14, radius - 4)}" fill="rgba(255,255,255,0.03)" />
      <text x="${x + paddingX}" y="${y + 20}" fill="#eef5ff" font-size="14" font-family="${EXPORT_FONT_FAMILY}" font-weight="700">${escapeXml(
        title
      )}</text>
      <text x="${x + paddingX}" y="${y + titleHeight - 8}" fill="#7e91a7" font-size="11" font-family="${EXPORT_FONT_FAMILY}" font-weight="600">${escapeXml(
        metaLabel
      )}</text>
      ${
        statusLabel
          ? `<rect x="${x + width - paddingX - 64}" y="${y + 10}" width="64" height="22" rx="11" fill="rgba(5,8,11,0.72)" stroke="rgba(255,255,255,0.06)" />
             <text x="${x + width - paddingX - 32}" y="${y + 25}" fill="${statusFill}" text-anchor="middle" font-size="11" font-family="${EXPORT_FONT_FAMILY}" font-weight="700">${escapeXml(
               statusLabel
             )}</text>`
          : ""
      }
      ${
        showImage
          ? `
            <defs>
              <clipPath id="${imageClipId}">
                <rect x="${bodyX}" y="${bodyY}" width="${bodyWidth}" height="${imageHeight}" rx="${Math.max(12, radius - 8)}" />
              </clipPath>
            </defs>
            <rect x="${bodyX}" y="${bodyY}" width="${bodyWidth}" height="${imageHeight}" rx="${Math.max(12, radius - 8)}" fill="#0b1014" stroke="rgba(255,255,255,0.05)" />
            <image href="${escapeXml(previewImageDataUrl || "")}" x="${bodyX}" y="${bodyY}" width="${bodyWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${imageClipId})" />
            <rect x="${bodyX}" y="${bodyY + imageHeight - 34}" width="${bodyWidth}" height="34" fill="rgba(4,6,10,0.54)" clip-path="url(#${imageClipId})" />
            <text x="${bodyX + 12}" y="${bodyY + imageHeight - 12}" fill="#edf4ff" font-size="12" font-family="${EXPORT_FONT_FAMILY}" font-weight="700">${escapeXml(
              node.kind === "model" ? node.displayModelName || node.modelId : node.label
            )}</text>
          `
          : ""
      }
      ${
        node.kind === "list" && !showImage
          ? renderListTable(nodeEntry, bodyX, bodyY, bodyWidth, Math.max(56, bodyHeight - 8))
          : ""
      }
      ${!showImage && node.kind !== "list" ? renderTextLines(summaryLines, bodyX, textBlockY, 18) : ""}
    </g>
  `;
}

export function buildCanvasExportSvg(input: BuildCanvasExportSvgInput) {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const edgeMarkup = input.edges
    .map((edge) => {
      const stroke = getCanvasNodeAccentColor(edge.semanticType);
      const dash = edge.lineStyle === "dashed" ? ` stroke-dasharray="10 10"` : "";
      const path = curvePath(edge.startX, edge.startY, edge.endX, edge.endY);
      return `
        <path d="${path}" stroke="${stroke}" stroke-opacity="0.2" stroke-width="10" stroke-linecap="round" fill="none" />
        <path d="${path}" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" fill="none"${dash} />
      `;
    })
    .join("");
  const nodeMarkup = input.nodes.map((node) => renderNodeCard(node)).join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="canvas-export-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#06080b" />
          <stop offset="52%" stop-color="#0a1117" />
          <stop offset="100%" stop-color="#090d13" />
        </linearGradient>
        <radialGradient id="canvas-export-glow" cx="22%" cy="10%" r="92%">
          <stop offset="0%" stop-color="#76d3ff" stop-opacity="0.16" />
          <stop offset="44%" stop-color="#ff5bb0" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#canvas-export-bg)" rx="28" />
      <rect width="${width}" height="${height}" fill="url(#canvas-export-glow)" rx="28" />
      ${edgeMarkup}
      ${nodeMarkup}
    </svg>
  `.trim();
}
