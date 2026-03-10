import type { NormalizedOutput, ProviderExecutionMode } from "@/lib/types";

export type GeminiMixedOutputWarningCode = "mixed_output_missing_text";

export type GeminiMixedOutputDiagnostics = {
  requested: boolean;
  experimental: boolean;
  mode: "images_and_text";
  executionMode: ProviderExecutionMode;
  inputImageCount: number;
  rawResponseTextPresent: boolean;
  candidateTextPartCount: number;
  imagePartCount: number;
  warningCode: GeminiMixedOutputWarningCode | null;
  warningMessage: string | null;
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function readGeminiMixedOutputDiagnostics(value: unknown): GeminiMixedOutputDiagnostics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.requested !== true ||
    record.experimental !== true ||
    record.mode !== "images_and_text" ||
    (record.executionMode !== "generate" && record.executionMode !== "edit") ||
    !isNonNegativeInteger(record.inputImageCount) ||
    !isBoolean(record.rawResponseTextPresent) ||
    !isNonNegativeInteger(record.candidateTextPartCount) ||
    !isNonNegativeInteger(record.imagePartCount)
  ) {
    return null;
  }

  if (
    record.warningCode !== null &&
    record.warningCode !== undefined &&
    record.warningCode !== "mixed_output_missing_text"
  ) {
    return null;
  }

  if (
    record.warningMessage !== null &&
    record.warningMessage !== undefined &&
    typeof record.warningMessage !== "string"
  ) {
    return null;
  }

  return {
    requested: true,
    experimental: true,
    mode: "images_and_text",
    executionMode: record.executionMode,
    inputImageCount: record.inputImageCount,
    rawResponseTextPresent: record.rawResponseTextPresent,
    candidateTextPartCount: record.candidateTextPartCount,
    imagePartCount: record.imagePartCount,
    warningCode: record.warningCode === "mixed_output_missing_text" ? "mixed_output_missing_text" : null,
    warningMessage: typeof record.warningMessage === "string" ? record.warningMessage : null,
  };
}

export function getGeminiMixedOutputDiagnosticsFromOutputs(outputs: NormalizedOutput[]) {
  for (const output of outputs) {
    const diagnostics = readGeminiMixedOutputDiagnostics(output.metadata?.geminiMixedOutputDiagnostics);
    if (diagnostics) {
      return diagnostics;
    }
  }

  return null;
}

export function formatGeminiMixedOutputDiagnosticsNotice(
  diagnostics: GeminiMixedOutputDiagnostics | null | undefined
) {
  if (!diagnostics) {
    return null;
  }

  if (diagnostics.warningMessage) {
    return diagnostics.warningMessage;
  }

  const textSource = diagnostics.rawResponseTextPresent ? "direct response text" : "candidate text parts";
  return `Nano Banana 2 Images & Text is experimental. Gemini returned ${diagnostics.imagePartCount} image part(s) and ${diagnostics.candidateTextPartCount} text part(s) in ${diagnostics.executionMode} mode with ${diagnostics.inputImageCount} input image(s). Text was present via ${textSource}.`;
}
