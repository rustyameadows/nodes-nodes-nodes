export type ProviderTextOutputTarget = "note" | "list" | "template" | "smart";
export type OpenAiTextOutputTarget = ProviderTextOutputTarget;

export const DEFAULT_TEXT_OUTPUT_TARGET: ProviderTextOutputTarget = "note";
export const OPENAI_DEFAULT_TEXT_OUTPUT_TARGET: OpenAiTextOutputTarget = DEFAULT_TEXT_OUTPUT_TARGET;

export function readTextOutputTarget(
  value: unknown,
  fallback: ProviderTextOutputTarget = DEFAULT_TEXT_OUTPUT_TARGET
): ProviderTextOutputTarget {
  return value === "note" || value === "list" || value === "template" || value === "smart" ? value : fallback;
}

export function readOpenAiTextOutputTarget(
  value: unknown,
  fallback: OpenAiTextOutputTarget = OPENAI_DEFAULT_TEXT_OUTPUT_TARGET
): OpenAiTextOutputTarget {
  return readTextOutputTarget(value, fallback);
}

export function isStructuredTextOutputTarget(target: ProviderTextOutputTarget) {
  return target === "list" || target === "template" || target === "smart";
}

export function getTextOutputTargetLabel(target: ProviderTextOutputTarget) {
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

export function getOpenAiTextOutputTargetLabel(target: OpenAiTextOutputTarget) {
  return getTextOutputTargetLabel(target);
}
