import type { ProviderModel } from "@/components/workspace/types";
import type { ProviderExecutionMode } from "@/lib/types";
import {
  buildGeminiImageDebugRequest,
  getGeminiImageParameterDefinitions,
  getGeminiImageDefaultSettings,
  isRunnableGeminiImageModel,
  resolveGeminiImageSettings,
} from "@/lib/gemini-image-settings";
import {
  buildGeminiTextDebugRequest,
  getGeminiTextDefaultSettings,
  getGeminiTextParameterDefinitions,
  isRunnableGeminiTextModel,
  resolveGeminiTextSettings,
} from "@/lib/gemini-text-settings";
import {
  buildOpenAiImageDebugRequest,
  getOpenAiImageDefaultSettings,
  getOpenAiImageParameterDefinitions,
  isRunnableOpenAiImageModel,
  resolveOpenAiImageSettings,
} from "@/lib/openai-image-settings";
import {
  buildOpenAiTextDebugRequest,
  getOpenAiTextDefaultSettings,
  getOpenAiTextParameterDefinitions,
  isRunnableOpenAiTextModel,
  resolveOpenAiTextSettings,
} from "@/lib/openai-text-settings";
import {
  buildTopazGigapixelDebugRequest,
  getTopazGigapixelDefaultSettings,
  getTopazGigapixelParameterDefinitions,
  isRunnableTopazGigapixelModel,
  resolveTopazGigapixelSettings,
} from "@/lib/topaz-gigapixel-settings";

export function isRunnableTextModel(providerId: string | null | undefined, modelId: string | null | undefined) {
  return isRunnableOpenAiTextModel(providerId, modelId) || isRunnableGeminiTextModel(providerId, modelId);
}

export function isRunnableImageModel(providerId: string | null | undefined, modelId: string | null | undefined) {
  return isRunnableOpenAiImageModel(providerId, modelId) || isRunnableGeminiImageModel(providerId, modelId);
}

export function resolveTextModelSettings(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  rawSettings: Record<string, unknown> | undefined
) {
  if (isRunnableOpenAiTextModel(providerId, modelId)) {
    return resolveOpenAiTextSettings(rawSettings, modelId);
  }

  if (isRunnableGeminiTextModel(providerId, modelId)) {
    return resolveGeminiTextSettings(rawSettings, modelId);
  }

  return null;
}

export function resolveImageModelSettings(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  rawSettings: Record<string, unknown> | undefined,
  executionMode: ProviderExecutionMode
) {
  if (isRunnableOpenAiImageModel(providerId, modelId)) {
    return resolveOpenAiImageSettings(rawSettings, executionMode, modelId);
  }

  if (isRunnableGeminiImageModel(providerId, modelId)) {
    void executionMode;
    return resolveGeminiImageSettings(rawSettings, modelId);
  }

  return null;
}

export function resolveProviderModelSettings(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  rawSettings: Record<string, unknown> | undefined,
  executionMode: ProviderExecutionMode
) {
  const imageSettings = resolveImageModelSettings(providerId, modelId, rawSettings, executionMode);
  if (imageSettings) {
    return imageSettings.effectiveSettings;
  }

  const textSettings = resolveTextModelSettings(providerId, modelId, rawSettings);
  if (textSettings) {
    return textSettings.effectiveSettings;
  }

  if (isRunnableTopazGigapixelModel(providerId, modelId)) {
    return resolveTopazGigapixelSettings(rawSettings, modelId).effectiveSettings;
  }

  return rawSettings || {};
}

export function getProviderModelDefaultSettings(providerId: string | null | undefined, modelId: string | null | undefined) {
  if (isRunnableOpenAiImageModel(providerId, modelId)) {
    return getOpenAiImageDefaultSettings(modelId);
  }
  if (isRunnableGeminiImageModel(providerId, modelId)) {
    return getGeminiImageDefaultSettings(modelId);
  }
  if (isRunnableOpenAiTextModel(providerId, modelId)) {
    return getOpenAiTextDefaultSettings(modelId);
  }
  if (isRunnableGeminiTextModel(providerId, modelId)) {
    return getGeminiTextDefaultSettings(modelId);
  }
  if (isRunnableTopazGigapixelModel(providerId, modelId)) {
    return getTopazGigapixelDefaultSettings(modelId);
  }

  return {};
}

export function getProviderModelParameterDefinitions(
  providerId: string | null | undefined,
  modelId: string | null | undefined
) {
  if (isRunnableOpenAiImageModel(providerId, modelId)) {
    return getOpenAiImageParameterDefinitions(modelId);
  }
  if (isRunnableGeminiImageModel(providerId, modelId)) {
    return getGeminiImageParameterDefinitions(modelId);
  }
  if (isRunnableOpenAiTextModel(providerId, modelId)) {
    return getOpenAiTextParameterDefinitions(modelId);
  }
  if (isRunnableGeminiTextModel(providerId, modelId)) {
    return getGeminiTextParameterDefinitions(modelId);
  }
  if (isRunnableTopazGigapixelModel(providerId, modelId)) {
    return getTopazGigapixelParameterDefinitions(modelId);
  }

  return [];
}

export function buildProviderDebugRequest(input: {
  providerId: string;
  modelId: string;
  prompt: string;
  executionMode: ProviderExecutionMode;
  rawSettings: Record<string, unknown>;
  inputImageAssetIds: string[];
  inputAssets?: Array<{ assetId: string; mimeType: string; width: number | null; height: number | null }>;
}) {
  if (isRunnableOpenAiTextModel(input.providerId, input.modelId)) {
    return buildOpenAiTextDebugRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      rawSettings: input.rawSettings,
    });
  }

  if (isRunnableGeminiTextModel(input.providerId, input.modelId)) {
    return buildGeminiTextDebugRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      rawSettings: input.rawSettings,
    });
  }

  if (isRunnableOpenAiImageModel(input.providerId, input.modelId)) {
    return buildOpenAiImageDebugRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      executionMode: input.executionMode,
      rawSettings: input.rawSettings,
      inputImageAssetIds: input.inputImageAssetIds,
    });
  }

  if (isRunnableGeminiImageModel(input.providerId, input.modelId)) {
    return buildGeminiImageDebugRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      executionMode: input.executionMode,
      rawSettings: input.rawSettings,
      inputImageAssetIds: input.inputImageAssetIds,
    });
  }

  if (isRunnableTopazGigapixelModel(input.providerId, input.modelId)) {
    return buildTopazGigapixelDebugRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      rawSettings: input.rawSettings,
      inputImageAssetIds: input.inputImageAssetIds,
      inputAssets: input.inputAssets || [],
    });
  }

  return null;
}

export function getFallbackProviderModel(providers: ProviderModel[]): ProviderModel {
  const preferred =
    providers.find((provider) => provider.providerId === "openai" && provider.modelId === "gpt-image-1.5") ||
    providers.find((provider) => provider.capabilities.runnable) ||
    providers[0];
  if (preferred) {
    return preferred;
  }

  return {
    providerId: "openai" as const,
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: false,
      availability: "ready" as const,
      billingAvailability: "free_and_paid" as const,
      accessStatus: "blocked" as const,
      accessReason: "missing_key" as const,
      accessMessage: "Save OPENAI_API_KEY in Settings or set it in .env.local and restart the app.",
      lastCheckedAt: null,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: false,
      requirements: [
        {
          kind: "env" as const,
          key: "OPENAI_API_KEY",
          configured: false,
          label: "OpenAI API key",
        },
      ],
      promptMode: "required" as const,
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: OPENAI_IMAGE_INPUT_MIME_TYPES,
      maxInputImages: OPENAI_MAX_INPUT_IMAGES,
      parameters: getOpenAiImageParameterDefinitions("gpt-image-1.5"),
      defaults: getOpenAiImageDefaultSettings("gpt-image-1.5"),
    },
  };
}
