export type TemplatePreviewInlinePart =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "token";
      value: string;
      raw: string;
    };

const TEMPLATE_TOKEN_PATTERN = /\[\[([^[\]]+)\]\]/g;

export function tokenizeTemplatePreviewInline(value: string): TemplatePreviewInlinePart[] {
  if (!value) {
    return [];
  }

  const parts: TemplatePreviewInlinePart[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const tokenValue = match[1]?.trim() || raw;

    if (start > lastIndex) {
      parts.push({
        type: "text",
        value: value.slice(lastIndex, start),
      });
    }

    parts.push({
      type: "token",
      value: tokenValue,
      raw,
    });

    lastIndex = start + raw.length;
  }

  if (lastIndex < value.length) {
    parts.push({
      type: "text",
      value: value.slice(lastIndex),
    });
  }

  return parts;
}
