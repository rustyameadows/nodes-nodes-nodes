import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type { ProviderExecutionMode } from "@/lib/types";
import type { GeminiThinkingLevel } from "@/lib/gemini-text-settings";

export type GeminiImageAspectRatio =
  | "auto"
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";
export type GeminiImageSize = "512" | "1K" | "2K" | "4K";
export type GeminiImageOutputMode = "images_and_text" | "images_only";

export const GEMINI_IMAGE_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const GEMINI_MAX_INPUT_IMAGES = 1;
export const GEMINI_RUNNABLE_IMAGE_MODEL_IDS = [
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
] as const;

type GeminiImageModelProfile = {
  maxOutputTokens: number;
  defaultTemperature: number;
  defaultTopP: number;
  supportsImageSize: boolean;
  imageSizeOptions: readonly GeminiImageSize[];
  defaultImageSize?: GeminiImageSize;
  supportsThinkingLevel: boolean;
  defaultThinkingLevel?: GeminiThinkingLevel;
  supportsOutputMode: boolean;
  defaultOutputMode?: GeminiImageOutputMode;
};

type GeminiImageResolvedSettings = {
  outputCount: 1;
  aspectRatio: GeminiImageAspectRatio;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  stopSequences: string | null;
  stopSequenceList: string[];
  imageSize: GeminiImageSize | null;
  thinkingLevel: GeminiThinkingLevel | null;
  outputMode: GeminiImageOutputMode | null;
  effectiveSettings: Record<string, unknown>;
};

const GEMINI_IMAGE_TEMPERATURE_MIN = 0;
const GEMINI_IMAGE_TEMPERATURE_MAX = 2;
const GEMINI_IMAGE_TOP_P_MIN = 0;
const GEMINI_IMAGE_TOP_P_MAX = 1;

const GEMINI_IMAGE_ASPECT_RATIO_OPTIONS: ModelParameterDefinition["options"] = [
  { value: "auto", label: "Auto" },
  { value: "1:1", label: "1:1" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
];

const GEMINI_IMAGE_SIZE_OPTIONS: ModelParameterDefinition["options"] = [
  { value: "512", label: "512" },
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GEMINI_IMAGE_THINKING_LEVEL_OPTIONS: ModelParameterDefinition["options"] = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const GEMINI_IMAGE_OUTPUT_MODE_OPTIONS: ModelParameterDefinition["options"] = [
  { value: "images_and_text", label: "Images & Text" },
  { value: "images_only", label: "Images Only" },
];

const GEMINI_IMAGE_MODEL_PROFILES: Record<(typeof GEMINI_RUNNABLE_IMAGE_MODEL_IDS)[number], GeminiImageModelProfile> = {
  "gemini-2.5-flash-image": {
    maxOutputTokens: 32768,
    defaultTemperature: 1,
    defaultTopP: 0.95,
    supportsImageSize: false,
    imageSizeOptions: [],
    supportsThinkingLevel: false,
    supportsOutputMode: false,
  },
  "gemini-3-pro-image-preview": {
    maxOutputTokens: 32768,
    defaultTemperature: 1,
    defaultTopP: 0.95,
    supportsImageSize: true,
    imageSizeOptions: ["1K", "2K", "4K"],
    defaultImageSize: "1K",
    supportsThinkingLevel: false,
    supportsOutputMode: false,
  },
  "gemini-3.1-flash-image-preview": {
    maxOutputTokens: 65536,
    defaultTemperature: 1,
    defaultTopP: 0.95,
    supportsImageSize: true,
    imageSizeOptions: ["512", "1K", "2K", "4K"],
    defaultImageSize: "1K",
    supportsThinkingLevel: true,
    defaultThinkingLevel: "minimal",
    supportsOutputMode: true,
    defaultOutputMode: "images_and_text",
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readOptionalNumber(
  value: unknown,
  options: {
    min: number;
    max?: number;
  }
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue)) {
    return null;
  }

  if (options.max === undefined) {
    return Math.max(options.min, nextValue);
  }

  return clamp(nextValue, options.min, options.max);
}

function readAspectRatio(value: unknown): GeminiImageAspectRatio {
  return GEMINI_IMAGE_ASPECT_RATIO_OPTIONS.some((option) => option.value === value)
    ? (value as GeminiImageAspectRatio)
    : "auto";
}

function parseStopSequences(value: unknown) {
  const source =
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string")
          .join("\n")
      : typeof value === "string"
        ? value
        : "";
  const stopSequenceList = source
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    stopSequences: stopSequenceList.length > 0 ? stopSequenceList.join("\n") : null,
    stopSequenceList,
  };
}

function readImageSize(value: unknown, profile: GeminiImageModelProfile): GeminiImageSize | null {
  if (!profile.supportsImageSize) {
    return null;
  }

  return profile.imageSizeOptions.includes(value as GeminiImageSize)
    ? (value as GeminiImageSize)
    : (profile.defaultImageSize || null);
}

function readThinkingLevel(value: unknown, profile: GeminiImageModelProfile): GeminiThinkingLevel | null {
  if (!profile.supportsThinkingLevel || !profile.defaultThinkingLevel) {
    return null;
  }

  return GEMINI_IMAGE_THINKING_LEVEL_OPTIONS.some((option) => option.value === value)
    ? (value as GeminiThinkingLevel)
    : profile.defaultThinkingLevel;
}

function readOutputMode(value: unknown, profile: GeminiImageModelProfile): GeminiImageOutputMode | null {
  if (!profile.supportsOutputMode || !profile.defaultOutputMode) {
    return null;
  }

  return GEMINI_IMAGE_OUTPUT_MODE_OPTIONS.some((option) => option.value === value)
    ? (value as GeminiImageOutputMode)
    : profile.defaultOutputMode;
}

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

export function getGeminiImageModelProfile(modelId: string | null | undefined): GeminiImageModelProfile {
  if (modelId && modelId in GEMINI_IMAGE_MODEL_PROFILES) {
    return GEMINI_IMAGE_MODEL_PROFILES[modelId as keyof typeof GEMINI_IMAGE_MODEL_PROFILES];
  }

  return GEMINI_IMAGE_MODEL_PROFILES["gemini-2.5-flash-image"];
}

export function getGeminiImageDefaultSettings(modelId: string | null | undefined) {
  const profile = getGeminiImageModelProfile(modelId);
  return {
    temperature: profile.defaultTemperature,
    aspectRatio: "auto",
    maxOutputTokens: profile.maxOutputTokens,
    topP: profile.defaultTopP,
    ...(profile.supportsImageSize && profile.defaultImageSize ? { imageSize: profile.defaultImageSize } : {}),
    ...(profile.supportsThinkingLevel && profile.defaultThinkingLevel
      ? { thinkingLevel: profile.defaultThinkingLevel }
      : {}),
    ...(profile.supportsOutputMode && profile.defaultOutputMode ? { outputMode: profile.defaultOutputMode } : {}),
  };
}

export function getGeminiImageParameterDefinitions(modelId: string | null | undefined): ModelParameterDefinition[] {
  const profile = getGeminiImageModelProfile(modelId);

  return [
    ...(profile.supportsOutputMode
      ? [
          {
            key: "outputMode",
            label: "Output Format",
            control: "select" as const,
            section: "core" as const,
            defaultValue: profile.defaultOutputMode,
            options: GEMINI_IMAGE_OUTPUT_MODE_OPTIONS,
          },
        ]
      : []),
    {
      key: "temperature",
      label: "Temperature",
      control: "number",
      section: "core",
      min: GEMINI_IMAGE_TEMPERATURE_MIN,
      max: GEMINI_IMAGE_TEMPERATURE_MAX,
      step: 0.1,
      defaultValue: profile.defaultTemperature,
    },
    {
      key: "aspectRatio",
      label: "Aspect Ratio",
      control: "select",
      section: "core",
      defaultValue: "auto",
      options: GEMINI_IMAGE_ASPECT_RATIO_OPTIONS,
    },
    ...(profile.supportsImageSize
      ? [
          {
            key: "imageSize",
            label: "Resolution",
            control: "select" as const,
            section: "core" as const,
            defaultValue: profile.defaultImageSize,
            options: GEMINI_IMAGE_SIZE_OPTIONS.filter((option) =>
              profile.imageSizeOptions.includes(option.value as GeminiImageSize)
            ),
          },
        ]
      : []),
    ...(profile.supportsThinkingLevel
      ? [
          {
            key: "thinkingLevel",
            label: "Thinking Level",
            control: "select" as const,
            section: "core" as const,
            defaultValue: profile.defaultThinkingLevel,
            options: GEMINI_IMAGE_THINKING_LEVEL_OPTIONS,
          },
        ]
      : []),
    {
      key: "maxOutputTokens",
      label: "Output Length",
      control: "number",
      section: "advanced",
      min: 1,
      max: profile.maxOutputTokens,
      step: 1,
      defaultValue: profile.maxOutputTokens,
    },
    {
      key: "topP",
      label: "Top P",
      control: "number",
      section: "advanced",
      min: GEMINI_IMAGE_TOP_P_MIN,
      max: GEMINI_IMAGE_TOP_P_MAX,
      step: 0.05,
      defaultValue: profile.defaultTopP,
    },
    {
      key: "stopSequences",
      label: "Stop Sequences",
      control: "textarea",
      section: "advanced",
      rows: 2,
      placeholder: "One stop sequence per line",
    },
  ];
}

export function resolveGeminiImageSettings(
  rawSettings: Record<string, unknown> | undefined,
  modelId: string | null | undefined
): GeminiImageResolvedSettings {
  const settings = rawSettings || {};
  const profile = getGeminiImageModelProfile(modelId);
  const aspectRatio = readAspectRatio(settings.aspectRatio);
  const temperature =
    readOptionalNumber(settings.temperature, {
      min: GEMINI_IMAGE_TEMPERATURE_MIN,
      max: GEMINI_IMAGE_TEMPERATURE_MAX,
    }) ?? profile.defaultTemperature;
  const topP =
    readOptionalNumber(settings.topP, {
      min: GEMINI_IMAGE_TOP_P_MIN,
      max: GEMINI_IMAGE_TOP_P_MAX,
    }) ?? profile.defaultTopP;
  const maxOutputTokens =
    readOptionalNumber(settings.maxOutputTokens, {
      min: 1,
      max: profile.maxOutputTokens,
    }) ?? profile.maxOutputTokens;
  const { stopSequences, stopSequenceList } = parseStopSequences(settings.stopSequences);
  const imageSize = readImageSize(settings.imageSize, profile);
  const thinkingLevel = readThinkingLevel(settings.thinkingLevel, profile);
  const outputMode = readOutputMode(settings.outputMode, profile);

  const effectiveSettings: Record<string, unknown> = {
    temperature,
    aspectRatio,
    maxOutputTokens,
    topP,
    ...(stopSequences ? { stopSequences } : {}),
    ...(imageSize ? { imageSize } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(outputMode ? { outputMode } : {}),
  };

  return {
    outputCount: 1,
    aspectRatio,
    temperature,
    topP,
    maxOutputTokens,
    stopSequences,
    stopSequenceList,
    imageSize,
    thinkingLevel,
    outputMode,
    effectiveSettings,
  };
}

export function buildGeminiImageGenerateConfig(
  rawSettings: Record<string, unknown> | undefined,
  modelId: string | null | undefined
) {
  const resolved = resolveGeminiImageSettings(rawSettings, modelId);
  const imageConfig: Record<string, unknown> = {};
  if (resolved.aspectRatio !== "auto") {
    imageConfig.aspectRatio = resolved.aspectRatio;
  }
  if (resolved.imageSize) {
    imageConfig.imageSize = resolved.imageSize;
  }

  const config: Record<string, unknown> = {
    responseModalities: resolved.outputMode === "images_and_text" ? ["TEXT", "IMAGE"] : ["IMAGE"],
    temperature: resolved.temperature,
    topP: resolved.topP,
    maxOutputTokens: resolved.maxOutputTokens,
    ...(resolved.stopSequenceList.length > 0 ? { stopSequences: resolved.stopSequenceList } : {}),
    ...(resolved.thinkingLevel ? { thinkingConfig: { thinkingLevel: resolved.thinkingLevel } } : {}),
    ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
  };

  return {
    resolved,
    config,
  };
}

export function buildGeminiImageDebugRequest(input: {
  modelId: string;
  prompt: string;
  executionMode: ProviderExecutionMode;
  rawSettings: Record<string, unknown>;
  inputImageAssetIds: string[];
}) {
  const { resolved, config } = buildGeminiImageGenerateConfig(input.rawSettings, input.modelId);

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
      config,
    },
    effectiveSettings: resolved.effectiveSettings,
    validationError: null,
  };
}
