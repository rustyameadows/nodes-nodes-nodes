import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { ProviderExecutionMode } from "@/lib/types";

export const GEMINI_IMAGE_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const GEMINI_MAX_INPUT_IMAGES = 1;
export const GEMINI_RUNNABLE_IMAGE_MODEL_IDS = [
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
] as const;

export function isRunnableGeminiImageModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined
) {
  return (
    providerId === "google-gemini" &&
    typeof modelId === "string" &&
    (GEMINI_RUNNABLE_IMAGE_MODEL_IDS as readonly string[]).includes(modelId)
  );
}

export function getGeminiImageDefaultSettings() {
  return {};
}

export function getGeminiImageParameterDefinitions(): ModelParameterDefinition[] {
  return [];
}

export function resolveGeminiImageSettings(rawSettings: Record<string, unknown> | undefined) {
  const settings = rawSettings || {};
  return {
    outputCount: 1,
    effectiveSettings: settings,
  };
}

export function buildGeminiImageDebugRequest(input: {
  modelId: string;
  prompt: string;
  executionMode: ProviderExecutionMode;
  rawSettings: Record<string, unknown>;
  inputImageAssetIds: string[];
}) {
  const resolved = resolveGeminiImageSettings(input.rawSettings);
  return {
    endpoint: "ai.models.generateContent",
    request: {
      model: input.modelId,
      contents:
        input.executionMode === "edit"
          ? [
              { text: input.prompt },
              ...input.inputImageAssetIds.map((assetId) => ({ inputAssetId: assetId })),
            ]
          : input.prompt,
      config: {
        responseModalities: ["IMAGE"],
      },
    },
    effectiveSettings: resolved.effectiveSettings,
    validationError: null,
  };
}
