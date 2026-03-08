export type OpenAiTextOutputTarget = "note" | "list" | "template" | "smart";

export const OPENAI_DEFAULT_TEXT_OUTPUT_TARGET: OpenAiTextOutputTarget = "note";

export function readOpenAiTextOutputTarget(
  value: unknown,
  fallback: OpenAiTextOutputTarget = OPENAI_DEFAULT_TEXT_OUTPUT_TARGET
): OpenAiTextOutputTarget {
  return value === "note" || value === "list" || value === "template" || value === "smart" ? value : fallback;
}

export function isStructuredTextOutputTarget(target: OpenAiTextOutputTarget) {
  return target === "list" || target === "template" || target === "smart";
}

export function getOpenAiTextOutputTargetLabel(target: OpenAiTextOutputTarget) {
  if (target === "list") {
    return "1 list node";
  }
  if (target === "template") {
    return "1 template node";
  }
  if (target === "smart") {
    return "smart structured nodes";
  }
  return "1 text note";
}
