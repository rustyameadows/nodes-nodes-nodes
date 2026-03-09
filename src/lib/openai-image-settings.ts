import type { ModelParameterDefinition } from "@/lib/model-parameters";
import type {
  ImageBackground,
  ImageInputFidelity,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
  OpenAIImageMode,
} from "@/lib/types";

export const OPENAI_IMAGE_INPUT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const OPENAI_DEFAULT_OUTPUT_FORMAT: ImageOutputFormat = "png";
export const OPENAI_DEFAULT_QUALITY: ImageQuality = "auto";
export const OPENAI_DEFAULT_SIZE: ImageSize = "auto";
export const OPENAI_DEFAULT_INPUT_FIDELITY: ImageInputFidelity = "high";
export const OPENAI_DEFAULT_BACKGROUND: ImageBackground = "auto";
export const OPENAI_DEFAULT_MODERATION: ImageModeration = "auto";
export const OPENAI_DEFAULT_OUTPUT_COUNT = 1;
export const OPENAI_MAX_INPUT_IMAGES = 5;
export const OPENAI_MAX_OUTPUT_COUNT = 4;
export const OPENAI_RUNNABLE_IMAGE_MODEL_IDS = ["gpt-image-1.5", "gpt-image-1-mini"] as const;

type OpenAiImageModelProfile = {
  supportedInputFidelityValues: readonly ImageInputFidelity[];
  defaultInputFidelity: ImageInputFidelity | null;
};

const OPENAI_IMAGE_MODEL_PROFILES: Record<(typeof OPENAI_RUNNABLE_IMAGE_MODEL_IDS)[number], OpenAiImageModelProfile> = {
  "gpt-image-1.5": {
    supportedInputFidelityValues: ["high", "low"],
    defaultInputFidelity: "high",
  },
  "gpt-image-1-mini": {
    supportedInputFidelityValues: ["low"],
    defaultInputFidelity: "low",
  },
};

export function isRunnableOpenAiImageModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined
) {
  return (
    providerId === "openai" &&
    typeof modelId === "string" &&
    (OPENAI_RUNNABLE_IMAGE_MODEL_IDS as readonly string[]).includes(modelId)
  );
}

export function getOpenAiImageModelProfile(modelId: string | null | undefined): OpenAiImageModelProfile {
  if (modelId && modelId in OPENAI_IMAGE_MODEL_PROFILES) {
    return OPENAI_IMAGE_MODEL_PROFILES[modelId as keyof typeof OPENAI_IMAGE_MODEL_PROFILES];
  }

  return OPENAI_IMAGE_MODEL_PROFILES["gpt-image-1.5"];
}

export function getOpenAiImageDefaultSettings(modelId: string | null | undefined) {
  const profile = getOpenAiImageModelProfile(modelId);

  return {
    outputFormat: OPENAI_DEFAULT_OUTPUT_FORMAT,
    quality: OPENAI_DEFAULT_QUALITY,
    size: OPENAI_DEFAULT_SIZE,
    background: OPENAI_DEFAULT_BACKGROUND,
    moderation: OPENAI_DEFAULT_MODERATION,
    ...(profile.defaultInputFidelity ? { inputFidelity: profile.defaultInputFidelity } : {}),
    n: OPENAI_DEFAULT_OUTPUT_COUNT,
  };
}

export function getOpenAiImageParameterDefinitions(modelId: string | null | undefined): ModelParameterDefinition[] {
  const profile = getOpenAiImageModelProfile(modelId);

  return OPENAI_IMAGE_PARAMETER_DEFINITIONS.map((definition) => {
    if (definition.key !== "inputFidelity" || !definition.options) {
      return definition;
    }

    return {
      ...definition,
      options: definition.options.filter((option) =>
        profile.supportedInputFidelityValues.includes(option.value as ImageInputFidelity)
      ),
      defaultValue: profile.defaultInputFidelity,
    };
  });
}

export const OPENAI_IMAGE_PARAMETER_DEFINITIONS: ModelParameterDefinition[] = [
  {
    key: "size",
    label: "Aspect Ratio",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_SIZE,
    options: [
      { value: "auto", label: "Auto" },
      { value: "1024x1024", label: "Square" },
      { value: "1024x1536", label: "Portrait" },
      { value: "1536x1024", label: "Landscape" },
    ],
  },
  {
    key: "quality",
    label: "Resolution",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_QUALITY,
    options: [
      { value: "auto", label: "Auto" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  {
    key: "background",
    label: "Transparency",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_BACKGROUND,
    options: [
      { value: "auto", label: "Auto" },
      { value: "opaque", label: "Opaque" },
      { value: "transparent", label: "Transparent" },
    ],
  },
  {
    key: "outputFormat",
    label: "Format",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_OUTPUT_FORMAT,
    options: [
      { value: "png", label: "PNG" },
      { value: "jpeg", label: "JPEG" },
      { value: "webp", label: "WebP" },
    ],
  },
  {
    key: "n",
    label: "Outputs",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_OUTPUT_COUNT,
    options: [
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
      { value: 4, label: "4" },
    ],
  },
  {
    key: "inputFidelity",
    label: "Input Fidelity",
    control: "select",
    section: "advanced",
    defaultValue: OPENAI_DEFAULT_INPUT_FIDELITY,
    options: [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
    visibleWhen: [{ executionModes: ["edit"] }],
  },
  {
    key: "outputCompression",
    label: "Compression",
    control: "number",
    section: "advanced",
    min: 0,
    max: 100,
    step: 1,
    placeholder: "Unset",
    visibleWhen: [
      {
        settingKey: "outputFormat",
        values: ["jpeg", "webp"],
      },
    ],
  },
  {
    key: "moderation",
    label: "Moderation",
    control: "select",
    section: "advanced",
    defaultValue: OPENAI_DEFAULT_MODERATION,
    options: [
      { value: "auto", label: "Auto" },
      { value: "low", label: "Low" },
    ],
    visibleWhen: [{ executionModes: ["generate"] }],
  },
];

function readOutputFormat(value: unknown, fallback: ImageOutputFormat): ImageOutputFormat {
  return value === "png" || value === "jpeg" || value === "webp" ? value : fallback;
}

function readQuality(value: unknown, fallback: ImageQuality): ImageQuality {
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : fallback;
}

function readSize(value: unknown, fallback: ImageSize): ImageSize {
  return value === "1024x1024" || value === "1536x1024" || value === "1024x1536" || value === "auto"
    ? value
    : fallback;
}

function readInputFidelity(value: unknown, fallback: ImageInputFidelity): ImageInputFidelity {
  return value === "high" || value === "low" ? value : fallback;
}

function readBackground(value: unknown, fallback: ImageBackground): ImageBackground {
  return value === "auto" || value === "opaque" || value === "transparent" ? value : fallback;
}

function readModeration(value: unknown, fallback: ImageModeration): ImageModeration {
  return value === "auto" || value === "low" ? value : fallback;
}

function readOutputCount(value: unknown, fallback: number): number {
  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(nextValue)) {
    return fallback;
  }
  return clamp(nextValue, 1, OPENAI_MAX_OUTPUT_COUNT);
}

function readOutputCompression(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue)) {
    return null;
  }

  return clamp(Math.round(nextValue), 0, 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseImageSize(size: ImageSize) {
  if (size === "1536x1024") {
    return { width: 1536, height: 1024 };
  }
  if (size === "1024x1536") {
    return { width: 1024, height: 1536 };
  }
  if (size === "1024x1024") {
    return { width: 1024, height: 1024 };
  }
  return null;
}

export function resolveOpenAiImageSettings(
  rawSettings: Record<string, unknown> | undefined,
  executionMode: OpenAIImageMode,
  modelId?: string | null
) {
  const settings = rawSettings || {};
  const profile = getOpenAiImageModelProfile(modelId);
  const outputFormat = readOutputFormat(settings.outputFormat, OPENAI_DEFAULT_OUTPUT_FORMAT);
  const quality = readQuality(settings.quality, OPENAI_DEFAULT_QUALITY);
  const size = readSize(settings.size, OPENAI_DEFAULT_SIZE);
  const moderation =
    executionMode === "generate" ? readModeration(settings.moderation, OPENAI_DEFAULT_MODERATION) : null;
  const outputCount = readOutputCount(settings.n, OPENAI_DEFAULT_OUTPUT_COUNT);
  const inputFidelity =
    executionMode === "edit"
      ? readInputFidelity(settings.inputFidelity, profile.defaultInputFidelity || OPENAI_DEFAULT_INPUT_FIDELITY)
      : null;
  const normalizedInputFidelity =
    executionMode === "edit" && inputFidelity && profile.supportedInputFidelityValues.includes(inputFidelity)
      ? inputFidelity
      : executionMode === "edit"
        ? profile.defaultInputFidelity
        : null;

  let background = readBackground(settings.background, OPENAI_DEFAULT_BACKGROUND);
  if (outputFormat === "jpeg" && background === "transparent") {
    background = "opaque";
  }

  const outputCompression =
    outputFormat === "jpeg" || outputFormat === "webp" ? readOutputCompression(settings.outputCompression) : null;

  const effectiveSettings: Record<string, unknown> = {
    size,
    quality,
    background,
    outputFormat,
    n: outputCount,
  };

  if (moderation) {
    effectiveSettings.moderation = moderation;
  }

  if (executionMode === "edit" && normalizedInputFidelity) {
    effectiveSettings.inputFidelity = normalizedInputFidelity;
  }

  if (outputCompression !== null) {
    effectiveSettings.outputCompression = outputCompression;
  }

  return {
    size,
    quality,
    background,
    outputFormat,
    moderation,
    outputCount,
    inputFidelity: normalizedInputFidelity,
    outputCompression,
    effectiveSettings,
  };
}

export function buildOpenAiImageDebugRequest(input: {
  modelId: string;
  prompt: string;
  executionMode: OpenAIImageMode;
  rawSettings: Record<string, unknown>;
  inputImageAssetIds: string[];
}) {
  const resolved = resolveOpenAiImageSettings(input.rawSettings, input.executionMode, input.modelId);
  const endpoint = input.executionMode === "generate" ? "client.images.generate" : "client.images.edit";

  return {
    endpoint,
    request: {
      model: input.modelId,
      prompt: input.prompt,
      size: resolved.size,
      quality: resolved.quality,
      background: resolved.background,
      output_format: resolved.outputFormat,
      n: resolved.outputCount,
      stream: true,
      partial_images: 2,
      ...(resolved.moderation ? { moderation: resolved.moderation } : {}),
      ...(input.executionMode === "edit" && resolved.inputFidelity
        ? { input_fidelity: resolved.inputFidelity }
        : {}),
      ...(resolved.outputCompression !== null ? { output_compression: resolved.outputCompression } : {}),
      ...(input.executionMode === "edit" ? { inputAssetIds: input.inputImageAssetIds } : {}),
    },
    effectiveSettings: resolved.effectiveSettings,
    validationError: null,
  };
}
