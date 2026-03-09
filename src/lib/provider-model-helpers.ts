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
    return resolveGeminiTextSettings(rawSettings);
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
    return resolveGeminiImageSettings(rawSettings);
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
    return getGeminiImageDefaultSettings();
  }
  if (isRunnableOpenAiTextModel(providerId, modelId)) {
    return getOpenAiTextDefaultSettings(modelId);
  }
  if (isRunnableGeminiTextModel(providerId, modelId)) {
    return getGeminiTextDefaultSettings();
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
    return getGeminiImageParameterDefinitions();
  }
  if (isRunnableOpenAiTextModel(providerId, modelId)) {
    return getOpenAiTextParameterDefinitions(modelId);
  }
  if (isRunnableGeminiTextModel(providerId, modelId)) {
    return getGeminiTextParameterDefinitions();
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
