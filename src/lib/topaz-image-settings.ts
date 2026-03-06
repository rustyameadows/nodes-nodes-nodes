import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { OpenAIImageMode, ProviderPromptMode } from "@/lib/types";

export const TOPAZ_IMAGE_API_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/tiff"];
export const TOPAZ_IMAGE_API_RUNNABLE_MODEL_IDS = ["high_fidelity_v2", "redefine"] as const;
export const TOPAZ_IMAGE_API_DEFAULT_SCALE = 2;
export const TOPAZ_IMAGE_API_DEFAULT_CREATIVITY = 3;
export const TOPAZ_IMAGE_API_DEFAULT_TEXTURE = 3;
export const TOPAZ_IMAGE_API_MAX_INPUT_IMAGES = 1;
const TOPAZ_IMAGE_API_MAX_TEXTURE = 5;

type TopazImageModelId = (typeof TOPAZ_IMAGE_API_RUNNABLE_MODEL_IDS)[number];

type TopazImageModelProfile = {
  displayName: string;
  promptMode: ProviderPromptMode;
  endpointPath: "/enhance" | "/enhance-gen/async";
  requestMode: "sync" | "async";
  apiModel: string;
  scaleOptions: readonly number[];
  supportsCreativity: boolean;
  supportsTexture: boolean;
};

const TOPAZ_IMAGE_MODEL_PROFILES: Record<TopazImageModelId, TopazImageModelProfile> = {
  high_fidelity_v2: {
    displayName: "High Fidelity V2",
    promptMode: "unsupported",
    endpointPath: "/enhance",
    requestMode: "sync",
    apiModel: "High Fidelity V2",
    scaleOptions: [2, 4, 6],
    supportsCreativity: false,
    supportsTexture: false,
  },
  redefine: {
    displayName: "Redefine",
    promptMode: "optional",
    endpointPath: "/enhance-gen/async",
    requestMode: "async",
    apiModel: "Redefine",
    scaleOptions: [2, 4, 6],
    supportsCreativity: true,
    supportsTexture: true,
  },
};

function fallbackTopazProfile(): TopazImageModelProfile {
  return TOPAZ_IMAGE_MODEL_PROFILES.high_fidelity_v2;
}

export function normalizeLegacyTopazModelId(modelId: string | null | undefined) {
  if (modelId === "topaz-studio-main" || modelId === "gigapixel-fidelity") {
    return "high_fidelity_v2";
  }
  if (modelId === "gigapixel-redefine") {
    return "redefine";
  }
  return modelId;
}

export function isRunnableTopazImageModel(providerId: string | null | undefined, modelId: string | null | undefined) {
  return (
    providerId === "topaz" &&
    typeof modelId === "string" &&
    (TOPAZ_IMAGE_API_RUNNABLE_MODEL_IDS as readonly string[]).includes(normalizeLegacyTopazModelId(modelId) || "")
  );
}

export function getTopazImageModelProfile(modelId: string | null | undefined): TopazImageModelProfile {
  const normalizedModelId = normalizeLegacyTopazModelId(modelId);
  if (normalizedModelId && normalizedModelId in TOPAZ_IMAGE_MODEL_PROFILES) {
    return TOPAZ_IMAGE_MODEL_PROFILES[normalizedModelId as TopazImageModelId];
  }
  return fallbackTopazProfile();
}

export function getTopazImageDefaultSettings(modelId: string | null | undefined) {
  const profile = getTopazImageModelProfile(modelId);
  return {
    scale: profile.scaleOptions[0] || TOPAZ_IMAGE_API_DEFAULT_SCALE,
    ...(profile.supportsCreativity ? { creativity: TOPAZ_IMAGE_API_DEFAULT_CREATIVITY } : {}),
    ...(profile.supportsTexture ? { texture: TOPAZ_IMAGE_API_DEFAULT_TEXTURE } : {}),
  };
}

function scaleParameter(profile: TopazImageModelProfile): ModelParameterDefinition {
  return {
    key: "scale",
    label: "Scale",
    control: "select",
    section: "core",
    defaultValue: profile.scaleOptions[0] || TOPAZ_IMAGE_API_DEFAULT_SCALE,
    options: profile.scaleOptions.map((value) => ({ value, label: `${value}x` })),
  };
}

export function getTopazImageParameterDefinitions(modelId: string | null | undefined): ModelParameterDefinition[] {
  const profile = getTopazImageModelProfile(modelId);
  const definitions: ModelParameterDefinition[] = [scaleParameter(profile)];

  if (profile.supportsCreativity) {
    definitions.push({
      key: "creativity",
      label: "Creativity",
      control: "number",
      section: "advanced",
      defaultValue: TOPAZ_IMAGE_API_DEFAULT_CREATIVITY,
      min: 1,
      max: 6,
      step: 1,
    });
  }

  if (profile.supportsTexture) {
    definitions.push({
      key: "texture",
      label: "Texture",
      control: "number",
      section: "advanced",
      defaultValue: TOPAZ_IMAGE_API_DEFAULT_TEXTURE,
      min: 1,
      max: TOPAZ_IMAGE_API_MAX_TEXTURE,
      step: 1,
    });
  }

  return definitions;
}

export type TopazRequestOutputFormat = "png" | "jpeg" | "tiff";

export type TopazInputAssetPreview = {
  assetId: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
};

function coerceInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(parsed);
}

function clampToAllowedScale(value: number, allowed: readonly number[]) {
  if (allowed.includes(value)) {
    return value;
  }
  return allowed[0] || TOPAZ_IMAGE_API_DEFAULT_SCALE;
}

function clampTextureValue(value: number) {
  return Math.min(TOPAZ_IMAGE_API_MAX_TEXTURE, Math.max(1, value));
}

export function getTopazOutputFormatForMimeType(mimeType: string | null | undefined): TopazRequestOutputFormat {
  if (mimeType === "image/jpeg") {
    return "jpeg";
  }
  if (mimeType === "image/tiff") {
    return "tiff";
  }
  return "png";
}

export function buildTopazOutputDimensionFields(scale: number, inputAsset?: TopazInputAssetPreview | null) {
  const width =
    typeof inputAsset?.width === "number" && Number.isFinite(inputAsset.width) && inputAsset.width > 0
      ? Math.round(inputAsset.width)
      : null;
  const height =
    typeof inputAsset?.height === "number" && Number.isFinite(inputAsset.height) && inputAsset.height > 0
      ? Math.round(inputAsset.height)
      : null;

  if (width && height) {
    return {
      output_width: Math.round(width * scale),
      output_height: Math.round(height * scale),
      crop_to_fill: false,
    };
  }

  if (width) {
    return {
      output_width: Math.round(width * scale),
      crop_to_fill: false,
    };
  }

  if (height) {
    return {
      output_height: Math.round(height * scale),
      crop_to_fill: false,
    };
  }

  return {};
}

export function resolveTopazImageSettings(rawSettings: Record<string, unknown> | undefined, modelId: string | null | undefined) {
  const settings = rawSettings || {};
  const profile = getTopazImageModelProfile(modelId);
  const scale = clampToAllowedScale(
    coerceInteger(settings.scale, profile.scaleOptions[0] || TOPAZ_IMAGE_API_DEFAULT_SCALE),
    profile.scaleOptions
  );
  const creativity = profile.supportsCreativity
    ? clampTextureValue(coerceInteger(settings.creativity, TOPAZ_IMAGE_API_DEFAULT_CREATIVITY))
    : null;
  const texture = profile.supportsTexture
    ? clampTextureValue(coerceInteger(settings.texture, TOPAZ_IMAGE_API_DEFAULT_TEXTURE))
    : null;

  const effectiveSettings: Record<string, unknown> = {
    scale,
  };

  if (creativity !== null) {
    effectiveSettings.creativity = creativity;
  }

  if (texture !== null) {
    effectiveSettings.texture = texture;
  }

  return {
    scale,
    creativity,
    texture,
    effectiveSettings,
  };
}

export function buildTopazImageDebugRequest(options: {
  modelId: string;
  prompt: string;
  rawSettings: Record<string, unknown> | undefined;
  inputImageAssetIds: string[];
  inputAssets?: TopazInputAssetPreview[];
}) {
  const normalizedModelId = normalizeLegacyTopazModelId(options.modelId) || "high_fidelity_v2";
  const profile = getTopazImageModelProfile(normalizedModelId);
  const resolvedSettings = resolveTopazImageSettings(options.rawSettings, normalizedModelId);
  const prompt = options.prompt.trim();
  const primaryInputAsset = options.inputAssets?.[0] || null;
  const dimensionFields = buildTopazOutputDimensionFields(resolvedSettings.scale, primaryInputAsset);
  const outputFormat = getTopazOutputFormatForMimeType(primaryInputAsset?.mimeType);

  const request: Record<string, unknown> = {
    model: profile.apiModel,
    output_format: outputFormat,
    inputAssetIds: options.inputImageAssetIds,
    ...dimensionFields,
  };

  if (profile.promptMode !== "unsupported" && prompt) {
    request.prompt = prompt;
  }

  if (resolvedSettings.creativity !== null) {
    request.creativity = resolvedSettings.creativity;
  }

  if (resolvedSettings.texture !== null) {
    request.texture = resolvedSettings.texture;
  }

  return {
    endpoint: profile.endpointPath,
    requestMode: profile.requestMode,
    request,
    effectiveSettings: resolvedSettings.effectiveSettings,
  };
}

export function getTopazPromptMode(modelId: string | null | undefined): ProviderPromptMode {
  return getTopazImageModelProfile(modelId).promptMode;
}

export function getTopazExecutionModes(modelId: string | null | undefined): OpenAIImageMode[] {
  void modelId;
  return ["edit"];
}

export const TOPAZ_GIGAPIXEL_INPUT_MIME_TYPES = TOPAZ_IMAGE_API_INPUT_MIME_TYPES;
export const TOPAZ_GIGAPIXEL_RUNNABLE_MODEL_IDS = TOPAZ_IMAGE_API_RUNNABLE_MODEL_IDS;
export const TOPAZ_GIGAPIXEL_DEFAULT_SCALE = TOPAZ_IMAGE_API_DEFAULT_SCALE;
export const TOPAZ_GIGAPIXEL_DEFAULT_CREATIVITY = TOPAZ_IMAGE_API_DEFAULT_CREATIVITY;
export const TOPAZ_GIGAPIXEL_DEFAULT_TEXTURE = TOPAZ_IMAGE_API_DEFAULT_TEXTURE;
export const TOPAZ_GIGAPIXEL_MAX_INPUT_IMAGES = TOPAZ_IMAGE_API_MAX_INPUT_IMAGES;
export const isRunnableTopazGigapixelModel = isRunnableTopazImageModel;
export const getTopazGigapixelModelProfile = getTopazImageModelProfile;
export const getTopazGigapixelDefaultSettings = getTopazImageDefaultSettings;
export const getTopazGigapixelParameterDefinitions = getTopazImageParameterDefinitions;
export const resolveTopazGigapixelSettings = resolveTopazImageSettings;
export const buildTopazGigapixelDebugRequest = buildTopazImageDebugRequest;
