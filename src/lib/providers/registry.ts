import OpenAI, { toFile } from "openai";
import { getFirstUnconfiguredRequirement } from "@/lib/provider-readiness";
import type { ProviderCredentialKey } from "@/components/workspace/types";
import {
  resolveProviderCredential,
  resolveProviderCredentialValue,
} from "@/lib/runtime/provider-credentials";
import {
  GEMINI_IMAGE_INPUT_MIME_TYPES,
  GEMINI_MAX_INPUT_IMAGES,
  buildGeminiImageGenerateConfig,
  getGeminiImageDefaultSettings,
  getGeminiImageParameterDefinitions,
  isRunnableGeminiImageModel,
} from "@/lib/gemini-image-settings";
import {
  buildGeminiTextRequestConfig,
  getGeminiTextDefaultSettings,
  getGeminiTextParameterDefinitions,
  isRunnableGeminiTextModel,
  resolveGeminiTextSettings,
} from "@/lib/gemini-text-settings";
import {
  OPENAI_IMAGE_INPUT_MIME_TYPES,
  OPENAI_MAX_INPUT_IMAGES,
  getOpenAiImageDefaultSettings,
  getOpenAiImageParameterDefinitions,
  isRunnableOpenAiImageModel,
  parseImageSize,
  resolveOpenAiImageSettings,
} from "@/lib/openai-image-settings";
import {
  buildOpenAiTextRequestConfig,
  getOpenAiTextDefaultSettings,
  getOpenAiTextParameterDefinitions,
  isRunnableOpenAiTextModel,
  resolveOpenAiTextSettings,
} from "@/lib/openai-text-settings";
import type { ProviderTextOutputTarget } from "@/lib/text-output-targets";
import {
  getTopazExecutionModes,
  getTopazGigapixelDefaultSettings,
  getTopazGigapixelParameterDefinitions,
  getTopazPromptMode,
  normalizeLegacyTopazModelId,
  TOPAZ_GIGAPIXEL_INPUT_MIME_TYPES,
  TOPAZ_GIGAPIXEL_MAX_INPUT_IMAGES,
} from "@/lib/topaz-gigapixel-settings";
import {
  buildGoogleGeminiContents,
  classifyGoogleGeminiError,
  extractGoogleGeminiImageParts,
  extractGoogleGeminiText,
  getGoogleGeminiClient,
  inspectGoogleGeminiMixedOutputResponse,
} from "@/lib/server/google-gemini";
import type { GeminiMixedOutputDiagnostics } from "@/lib/gemini-mixed-output";
import { executeTopazImageApi } from "@/lib/server/topaz-image-api";
import type {
  OpenAIImageMode,
  ImageOutputFormat,
  NormalizedPreviewFrame,
  NormalizedOutput,
  ProviderAdapter,
  ProviderId,
  ProviderJobInput,
  ProviderModelCapabilities,
  ProviderModelDescriptor,
} from "@/lib/types";

type ProviderErrorCode =
  | "CONFIG_ERROR"
  | "COMING_SOON"
  | "INVALID_INPUT"
  | "PROVIDER_ERROR"
  | "BILLING_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_LISTED"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "TEMPORARY_UNAVAILABLE";

function createProviderError(
  code: ProviderErrorCode,
  message: string,
  details?: Record<string, unknown>
): Error & { code: ProviderErrorCode; details?: Record<string, unknown> } {
  const error = new Error(message) as Error & { code: ProviderErrorCode; details?: Record<string, unknown> };
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function buildEnvRequirement(envVar: ProviderCredentialKey, label: string, configured = false) {
  return {
    kind: "env" as const,
    key: envVar,
    configured,
    label,
  };
}

function buildCapabilities({
  text,
  image,
  video,
  runnable,
  availability,
  billingAvailability = "free_and_paid",
  accessStatus = "available",
  accessReason = null,
  accessMessage = null,
  lastCheckedAt = null,
  requiresApiKeyEnv = null,
  requirements = [],
  promptMode = "optional",
  executionModes = [],
  acceptedInputMimeTypes = [],
  maxInputImages = 0,
  parameters = [],
  defaults = {},
}: {
  text: boolean;
  image: boolean;
  video: boolean;
  runnable: boolean;
  availability: ProviderModelCapabilities["availability"];
  billingAvailability?: ProviderModelCapabilities["billingAvailability"];
  accessStatus?: ProviderModelCapabilities["accessStatus"];
  accessReason?: ProviderModelCapabilities["accessReason"];
  accessMessage?: ProviderModelCapabilities["accessMessage"];
  lastCheckedAt?: ProviderModelCapabilities["lastCheckedAt"];
  requiresApiKeyEnv?: string | null;
  requirements?: ProviderModelCapabilities["requirements"];
  promptMode?: ProviderModelCapabilities["promptMode"];
  executionModes?: ProviderModelCapabilities["executionModes"];
  acceptedInputMimeTypes?: string[];
  maxInputImages?: number;
  parameters?: ProviderModelCapabilities["parameters"];
  defaults?: ProviderModelCapabilities["defaults"];
}): ProviderModelCapabilities {
  const envRequirement =
    requiresApiKeyEnv &&
    !requirements.some((requirement) => requirement.kind === "env" && requirement.key === requiresApiKeyEnv)
      ? [buildEnvRequirement(requiresApiKeyEnv as ProviderCredentialKey, requiresApiKeyEnv)]
      : [];
  const mergedRequirements = [...requirements, ...envRequirement];
  const firstEnvRequirement = mergedRequirements.find((requirement) => requirement.kind === "env") || null;

  return {
    text,
    image,
    video,
    runnable,
    availability,
    billingAvailability,
    accessStatus,
    accessReason,
    accessMessage,
    lastCheckedAt,
    requiresApiKeyEnv: firstEnvRequirement?.key || requiresApiKeyEnv,
    apiKeyConfigured: firstEnvRequirement ? Boolean(firstEnvRequirement.configured) : true,
    requirements: mergedRequirements,
    promptMode,
    executionModes,
    acceptedInputMimeTypes,
    maxInputImages,
    parameters,
    defaults,
  };
}

function createOpenAiImageCapabilities(modelId: string) {
  return buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: true,
    availability: "ready",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    requirements: [buildEnvRequirement("OPENAI_API_KEY", "OpenAI API key")],
    promptMode: "required",
    executionModes: ["generate", "edit"],
    acceptedInputMimeTypes: OPENAI_IMAGE_INPUT_MIME_TYPES,
    maxInputImages: OPENAI_MAX_INPUT_IMAGES,
    parameters: getOpenAiImageParameterDefinitions(modelId),
    defaults: getOpenAiImageDefaultSettings(modelId),
  });
}

function createOpenAiTextCapabilities(modelId: string) {
  return buildCapabilities({
    text: true,
    image: false,
    video: false,
    runnable: true,
    availability: "ready",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    requirements: [buildEnvRequirement("OPENAI_API_KEY", "OpenAI API key")],
    promptMode: "required",
    executionModes: ["generate"],
    acceptedInputMimeTypes: [],
    maxInputImages: 0,
    parameters: getOpenAiTextParameterDefinitions(modelId),
    defaults: getOpenAiTextDefaultSettings(modelId),
  });
}

function createGeminiImageCapabilities(
  modelId: string,
  billingAvailability: ProviderModelCapabilities["billingAvailability"]
) {
  return buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: true,
    availability: "ready",
    billingAvailability,
    accessStatus: "unknown",
    accessReason: "probe_failed",
    accessMessage: "Gemini model access has not been verified yet.",
    requiresApiKeyEnv: "GOOGLE_API_KEY",
    requirements: [buildEnvRequirement("GOOGLE_API_KEY", "Google Gemini API key")],
    promptMode: "required",
    executionModes: ["generate", "edit"],
    acceptedInputMimeTypes: GEMINI_IMAGE_INPUT_MIME_TYPES,
    maxInputImages: GEMINI_MAX_INPUT_IMAGES,
    parameters: getGeminiImageParameterDefinitions(modelId),
    defaults: getGeminiImageDefaultSettings(modelId),
  });
}

function createGeminiTextCapabilities(
  modelId: string,
  billingAvailability: ProviderModelCapabilities["billingAvailability"]
) {
  return buildCapabilities({
    text: true,
    image: false,
    video: false,
    runnable: true,
    availability: "ready",
    billingAvailability,
    accessStatus: "unknown",
    accessReason: "probe_failed",
    accessMessage: "Gemini model access has not been verified yet.",
    requiresApiKeyEnv: "GOOGLE_API_KEY",
    requirements: [buildEnvRequirement("GOOGLE_API_KEY", "Google Gemini API key")],
    promptMode: "required",
    executionModes: ["generate"],
    parameters: getGeminiTextParameterDefinitions(modelId),
    defaults: getGeminiTextDefaultSettings(modelId),
  });
}

function createTopazGigapixelCapabilities(modelId: string) {
  return buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: true,
    availability: "ready",
    requirements: [
      {
        kind: "env",
        key: "TOPAZ_API_KEY",
        configured: false,
        label: "Topaz API key",
      },
    ],
    promptMode: getTopazPromptMode(modelId),
    executionModes: getTopazExecutionModes(modelId),
    acceptedInputMimeTypes: TOPAZ_GIGAPIXEL_INPUT_MIME_TYPES,
    maxInputImages: TOPAZ_GIGAPIXEL_MAX_INPUT_IMAGES,
    parameters: getTopazGigapixelParameterDefinitions(modelId),
    defaults: getTopazGigapixelDefaultSettings(modelId),
  });
}

async function resolveProviderModelCredentials(model: ProviderModelDescriptor): Promise<ProviderModelDescriptor> {
  const requirements = await Promise.all(
    model.capabilities.requirements.map(async (requirement) => {
      if (requirement.kind !== "env") {
        return requirement;
      }

      const resolved = await resolveProviderCredential(requirement.key as ProviderCredentialKey);
      return {
        ...requirement,
        configured: resolved.configured,
      };
    })
  );

  const firstEnvRequirement = requirements.find((requirement) => requirement.kind === "env") || null;
  const hasMissingRequirement = requirements.some((requirement) => requirement.configured === false);

  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      requirements,
      requiresApiKeyEnv: firstEnvRequirement?.key || model.capabilities.requiresApiKeyEnv,
      apiKeyConfigured: firstEnvRequirement ? Boolean(firstEnvRequirement.configured) : model.capabilities.apiKeyConfigured,
      accessStatus: hasMissingRequirement ? "blocked" : model.capabilities.accessStatus,
      accessReason: hasMissingRequirement ? "missing_key" : model.capabilities.accessReason,
      accessMessage: hasMissingRequirement
        ? `Save ${firstEnvRequirement?.key || model.capabilities.requiresApiKeyEnv} in Settings or set it in .env.local and restart the app.`
        : model.capabilities.accessMessage,
      lastCheckedAt: hasMissingRequirement ? null : model.capabilities.lastCheckedAt,
      runnable: model.capabilities.runnable && !hasMissingRequirement && model.capabilities.accessStatus !== "blocked",
    },
  };
}

function buildProviderCatalog(): Record<ProviderId, ProviderModelDescriptor[]> {
  const openAi15Capabilities = createOpenAiImageCapabilities("gpt-image-1.5");
  const openAiMiniCapabilities = createOpenAiImageCapabilities("gpt-image-1-mini");
  const gpt54Capabilities = createOpenAiTextCapabilities("gpt-5.4");
  const gpt5MiniCapabilities = createOpenAiTextCapabilities("gpt-5-mini");
  const gpt5NanoCapabilities = createOpenAiTextCapabilities("gpt-5-nano");

  const comingSoonImageCapabilities = buildCapabilities({
    text: false,
    image: true,
    video: false,
    runnable: false,
    availability: "coming_soon",
    promptMode: "optional",
    executionModes: [],
    parameters: [],
  });

  const comingSoonTextCapabilities = buildCapabilities({
    text: true,
    image: false,
    video: false,
    runnable: false,
    availability: "coming_soon",
    promptMode: "required",
    executionModes: [],
    parameters: [],
  });

  const nanoBananaCapabilities = createGeminiImageCapabilities("gemini-2.5-flash-image", "paid_only");
  const nanoBananaProCapabilities = createGeminiImageCapabilities("gemini-3-pro-image-preview", "paid_only");
  const nanoBanana2Capabilities = createGeminiImageCapabilities("gemini-3.1-flash-image-preview", "paid_only");
  const gemini31FlashLiteCapabilities = createGeminiTextCapabilities("gemini-3.1-flash-lite-preview", "free_and_paid");
  const gemini3FlashCapabilities = createGeminiTextCapabilities("gemini-3-flash-preview", "free_and_paid");
  const gemini25ProCapabilities = createGeminiTextCapabilities("gemini-2.5-pro", "free_and_paid");
  const gemini25FlashCapabilities = createGeminiTextCapabilities("gemini-2.5-flash", "free_and_paid");
  const gemini25FlashLiteCapabilities = createGeminiTextCapabilities("gemini-2.5-flash-lite", "free_and_paid");

  return {
    openai: [
      {
        providerId: "openai",
        modelId: "gpt-image-1.5",
        displayName: "GPT Image 1.5",
        capabilities: openAi15Capabilities,
        defaultSettings: { ...openAi15Capabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-image-1",
        displayName: "GPT Image 1",
        capabilities: comingSoonImageCapabilities,
        defaultSettings: {},
      },
      {
        providerId: "openai",
        modelId: "gpt-image-1-mini",
        displayName: "GPT Image 1 Mini",
        capabilities: openAiMiniCapabilities,
        defaultSettings: { ...openAiMiniCapabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-5.4",
        displayName: "GPT 5.4",
        capabilities: gpt54Capabilities,
        defaultSettings: { ...gpt54Capabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-5-mini",
        displayName: "GPT 5 Mini",
        capabilities: gpt5MiniCapabilities,
        defaultSettings: { ...gpt5MiniCapabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-5-nano",
        displayName: "GPT 5 Nano",
        capabilities: gpt5NanoCapabilities,
        defaultSettings: { ...gpt5NanoCapabilities.defaults },
      },
      {
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        displayName: "GPT 4.1 Mini",
        capabilities: comingSoonTextCapabilities,
        defaultSettings: {},
      },
    ],
    "google-gemini": [
      {
        providerId: "google-gemini",
        modelId: "gemini-2.5-flash-image",
        displayName: "Nano Banana",
        capabilities: nanoBananaCapabilities,
        defaultSettings: { ...nanoBananaCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-3-pro-image-preview",
        displayName: "Nano Banana Pro",
        capabilities: nanoBananaProCapabilities,
        defaultSettings: { ...nanoBananaProCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-3.1-flash-image-preview",
        displayName: "Nano Banana 2",
        capabilities: nanoBanana2Capabilities,
        defaultSettings: { ...nanoBanana2Capabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-3.1-flash-lite-preview",
        displayName: "Gemini 3.1 Flash-Lite",
        capabilities: gemini31FlashLiteCapabilities,
        defaultSettings: { ...gemini31FlashLiteCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-3-flash-preview",
        displayName: "Gemini 3 Flash",
        capabilities: gemini3FlashCapabilities,
        defaultSettings: { ...gemini3FlashCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        capabilities: gemini25ProCapabilities,
        defaultSettings: { ...gemini25ProCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        capabilities: gemini25FlashCapabilities,
        defaultSettings: { ...gemini25FlashCapabilities.defaults },
      },
      {
        providerId: "google-gemini",
        modelId: "gemini-2.5-flash-lite",
        displayName: "Gemini 2.5 Flash-Lite",
        capabilities: gemini25FlashLiteCapabilities,
        defaultSettings: { ...gemini25FlashLiteCapabilities.defaults },
      },
    ],
    topaz: [
      {
        providerId: "topaz",
        modelId: "high_fidelity_v2",
        displayName: "High Fidelity V2",
        capabilities: createTopazGigapixelCapabilities("high_fidelity_v2"),
        defaultSettings: getTopazGigapixelDefaultSettings("high_fidelity_v2"),
      },
      {
        providerId: "topaz",
        modelId: "redefine",
        displayName: "Redefine",
        capabilities: createTopazGigapixelCapabilities("redefine"),
        defaultSettings: getTopazGigapixelDefaultSettings("redefine"),
      },
    ],
  };
}

async function getOpenAIClient() {
  const apiKey = await resolveProviderCredentialValue("OPENAI_API_KEY");
  if (!apiKey) {
    throw createProviderError(
      "CONFIG_ERROR",
      "OpenAI is not configured. Save OPENAI_API_KEY in Settings or set it in .env.local and restart the app."
    );
  }

  return new OpenAI({ apiKey });
}

function getProviderModelDescriptor(providerId: ProviderId, modelId: string): ProviderModelDescriptor | null {
  const normalizedModelId =
    providerId === "topaz" ? normalizeLegacyTopazModelId(modelId) || "high_fidelity_v2" : modelId;
  const providerModels = buildProviderCatalog()[providerId] || [];
  return providerModels.find((model) => model.modelId === normalizedModelId) || null;
}

async function getResolvedProviderModelDescriptor(providerId: ProviderId, modelId: string) {
  const model = getProviderModelDescriptor(providerId, modelId);
  if (!model) {
    return null;
  }

  return resolveProviderModelCredentials(model);
}

function outputFormatToMimeType(outputFormat: ImageOutputFormat) {
  if (outputFormat === "jpeg") {
    return "image/jpeg";
  }
  if (outputFormat === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function readExecutionMode(value: unknown): OpenAIImageMode {
  return value === "generate" ? "generate" : "edit";
}

function outputIndexForStreamingPreview(completedOutputCount: number, requestedOutputCount: number) {
  if (requestedOutputCount <= 1) {
    return 0;
  }
  return Math.min(completedOutputCount, requestedOutputCount - 1);
}

function buildImageOutput(
  input: ProviderJobInput,
  executionMode: OpenAIImageMode,
  outputFormat: ImageOutputFormat,
  resolvedSettings: ReturnType<typeof resolveOpenAiImageSettings>,
  inputAssets: ProviderJobInput["inputAssets"],
  b64Json: string,
  outputIndex: number
): NormalizedOutput {
  const dimensions = parseImageSize(resolvedSettings.size);

  return {
    type: "image",
    mimeType: outputFormatToMimeType(outputFormat),
    extension: outputFormat === "jpeg" ? "jpg" : outputFormat,
    encoding: "binary",
    metadata: {
      providerId: input.providerId,
      modelId: input.modelId,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      executionMode,
      quality: resolvedSettings.quality,
      size: resolvedSettings.size,
      background: resolvedSettings.background,
      moderation: resolvedSettings.moderation,
      outputFormat,
      outputCount: resolvedSettings.outputCount,
      outputIndex,
      outputCompression: resolvedSettings.outputCompression,
      inputFidelity: executionMode === "edit" ? resolvedSettings.inputFidelity : null,
      inputAssetIds: inputAssets.map((asset) => asset.assetId),
      revisedPrompt: null,
    },
    content: Buffer.from(b64Json, "base64"),
  };
}

function buildPreviewFrame(
  mimeType: string,
  extension: string,
  size: ReturnType<typeof resolveOpenAiImageSettings>["size"],
  b64Json: string,
  outputIndex: number,
  previewIndex: number
): NormalizedPreviewFrame {
  const dimensions = parseImageSize(size);

  return {
    outputIndex,
    previewIndex,
    mimeType,
    extension,
    content: Buffer.from(b64Json, "base64"),
    metadata: {
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    },
  };
}

function buildTextOutput(
  input: ProviderJobInput,
  options: {
    textOutputTarget: ProviderTextOutputTarget;
    maxOutputTokens: number | null;
    outputIndex?: number;
    outputFormat?: string | null;
    responseId?: string | null;
    responseStatus?: string | null;
    usage?: unknown;
    metadata?: Record<string, unknown>;
  },
  content: string
): NormalizedOutput {
  const mimeType =
    options.textOutputTarget === "note" && (!options.outputFormat || options.outputFormat === "text")
      ? "text/plain"
      : "application/json";
  const extension =
    options.textOutputTarget === "note" && (!options.outputFormat || options.outputFormat === "text") ? "txt" : "json";

  return {
    type: "text",
    mimeType,
    extension,
    encoding: "utf-8",
    metadata: {
      providerId: input.providerId,
      modelId: input.modelId,
      outputIndex: options.outputIndex ?? 0,
      responseId: options.responseId || null,
      responseStatus: options.responseStatus || null,
      textOutputTarget: options.textOutputTarget,
      outputFormat: options.outputFormat || "text",
      maxOutputTokens: options.maxOutputTokens,
      usage: options.usage || null,
      ...(options.metadata || {}),
    },
    content,
  };
}

function buildGeminiImageOutput(
  input: ProviderJobInput,
  executionMode: OpenAIImageMode,
  mimeType: string,
  b64Data: string,
  outputIndex: number
): NormalizedOutput {
  return {
    type: "image",
    mimeType,
    extension: extensionForMimeType(mimeType),
    encoding: "binary",
    metadata: {
      providerId: input.providerId,
      modelId: input.modelId,
      outputIndex,
      executionMode,
      inputAssetIds: input.inputAssets.map((asset) => asset.assetId),
    },
    content: Buffer.from(b64Data, "base64"),
  };
}

export function buildGeminiImageOutputsFromResponse(input: {
  job: ProviderJobInput;
  executionMode: OpenAIImageMode;
  resolvedSettings: ReturnType<typeof buildGeminiImageGenerateConfig>["resolved"];
  response: Parameters<typeof extractGoogleGeminiImageParts>[0];
}) {
  const imageParts = extractGoogleGeminiImageParts(input.response);
  const text =
    input.resolvedSettings.outputMode === "images_and_text" ? extractGoogleGeminiText(input.response) : null;
  const mixedOutputStats =
    input.resolvedSettings.outputMode === "images_and_text"
      ? inspectGoogleGeminiMixedOutputResponse(input.response)
      : null;

  if (imageParts.length === 0) {
    throw createProviderError("PROVIDER_ERROR", "Gemini returned no image bytes.");
  }

  const outputs = imageParts.map((imagePart, outputIndex) =>
    buildGeminiImageOutput(input.job, input.executionMode, imagePart.mimeType, imagePart.data, outputIndex)
  );

  if (input.resolvedSettings.outputMode === "images_and_text" && text) {
    outputs.push(
      buildTextOutput(
        input.job,
        {
          textOutputTarget: "smart",
          maxOutputTokens: input.resolvedSettings.maxOutputTokens,
          outputIndex: outputs.length,
          outputFormat: "json_schema",
          metadata: {
            providerResponseModality: "TEXT",
            mixedOutputMode: "images_and_text",
          },
        },
        text
      )
    );
  }

  if (mixedOutputStats) {
    const diagnostics: GeminiMixedOutputDiagnostics = {
      requested: true,
      experimental: true,
      mode: "images_and_text",
      executionMode: input.executionMode,
      inputImageCount: input.job.inputAssets.length,
      rawResponseTextPresent: mixedOutputStats.rawResponseTextPresent,
      candidateTextPartCount: mixedOutputStats.candidateTextPartCount,
      imagePartCount: mixedOutputStats.imagePartCount,
      warningCode: text ? null : "mixed_output_missing_text",
      warningMessage: text
        ? null
        : `Nano Banana 2 Images & Text is experimental. Gemini returned ${mixedOutputStats.imagePartCount} image part(s) but no text for this ${input.executionMode} run with ${input.job.inputAssets.length} input image(s), so the job stayed image-only.`,
    };
    const firstOutput = outputs[0];
    if (firstOutput) {
      outputs[0] = {
        ...firstOutput,
        metadata: {
          ...firstOutput.metadata,
          geminiMixedOutputDiagnostics: diagnostics,
        },
      };
    }
  }

  return outputs;
}

async function submitOpenAiImage(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = await getResolvedProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  if (!model.capabilities.runnable) {
    throw createProviderError(
      "CONFIG_ERROR",
      "OpenAI is not configured. Save OPENAI_API_KEY in Settings or set it in .env.local and restart the app."
    );
  }

  const prompt = input.payload.prompt.trim();
  if (!prompt) {
    throw createProviderError("INVALID_INPUT", "Connect a prompt note or enter a prompt before running.");
  }

  const executionMode = readExecutionMode(input.payload.executionMode);
  const acceptedMimeTypes = new Set(model.capabilities.acceptedInputMimeTypes);
  const inputAssets = input.inputAssets
    .filter((asset) => asset.type === "image" && acceptedMimeTypes.has(asset.mimeType))
    .slice(0, model.capabilities.maxInputImages);

  if (executionMode === "generate" && inputAssets.length > 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Disconnect image inputs or switch the node to Edit mode before running."
    );
  }

  if (executionMode === "edit" && inputAssets.length === 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Connect at least one PNG, JPEG, or TIFF image input before running."
    );
  }

  const resolvedSettings = resolveOpenAiImageSettings(input.payload.settings, executionMode, input.modelId);
  const {
    outputFormat,
    quality,
    size,
    background,
    moderation,
    outputCount,
    inputFidelity,
    outputCompression,
  } = resolvedSettings;

  const client = await getOpenAIClient();
  const mimeType = outputFormatToMimeType(outputFormat);
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  const outputs: NormalizedOutput[] = [];

  const stream =
    executionMode === "generate"
      ? await client.images.generate({
          model: input.modelId,
          prompt,
          size,
          quality,
          background,
          output_format: outputFormat,
          moderation,
          n: outputCount,
          stream: true,
          partial_images: 2,
          ...(outputCompression !== null ? { output_compression: outputCompression } : {}),
        })
      : await client.images.edit({
          model: input.modelId,
          image: await Promise.all(
            inputAssets.map((asset, index) =>
              toFile(asset.buffer, `input-${index + 1}.${extensionForMimeType(asset.mimeType)}`, {
                type: asset.mimeType,
              })
            )
          ),
          prompt,
          size,
          quality,
          background,
          output_format: outputFormat,
          n: outputCount,
          stream: true,
          partial_images: 2,
          ...(inputFidelity ? { input_fidelity: inputFidelity } : {}),
          ...(outputCompression !== null ? { output_compression: outputCompression } : {}),
        });

  for await (const event of stream) {
    if (
      (event.type === "image_generation.partial_image" || event.type === "image_edit.partial_image") &&
      event.b64_json &&
      input.onPreviewFrame
    ) {
      const previewOutputIndex = outputIndexForStreamingPreview(outputs.length, outputCount);
      await input.onPreviewFrame(
        buildPreviewFrame(
          mimeType,
          extension,
          resolvedSettings.size,
          event.b64_json,
          previewOutputIndex,
          event.partial_image_index
        )
      );
      continue;
    }

    if (
      (event.type === "image_generation.completed" || event.type === "image_edit.completed") &&
      event.b64_json
    ) {
      outputs.push(
        buildImageOutput(
          input,
          executionMode,
          outputFormat,
          resolvedSettings,
          inputAssets,
          event.b64_json,
          outputs.length
        )
      );
    }
  }

  if (outputs.length === 0) {
    throw createProviderError("PROVIDER_ERROR", "OpenAI returned no image bytes.");
  }

  return outputs;
}

async function submitOpenAiText(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = await getResolvedProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  if (!model.capabilities.runnable) {
    throw createProviderError(
      "CONFIG_ERROR",
      "OpenAI is not configured. Save OPENAI_API_KEY in Settings or set it in .env.local and restart the app."
    );
  }

  const prompt = input.payload.prompt.trim();
  if (!prompt) {
    throw createProviderError("INVALID_INPUT", "Connect a prompt note or enter a prompt before running.");
  }

  if (input.inputAssets.length > 0 || input.payload.inputImageAssetIds.length > 0) {
    throw createProviderError("INVALID_INPUT", "Disconnect image inputs before running GPT text generation.");
  }

  const resolvedSettings = resolveOpenAiTextSettings(input.payload.settings, input.modelId);
  if (resolvedSettings.validationError) {
    throw createProviderError("INVALID_INPUT", resolvedSettings.validationError);
  }

  const requestConfig = buildOpenAiTextRequestConfig(resolvedSettings);
  const client = await getOpenAIClient();
  const response = await client.responses.create({
    model: input.modelId,
    input: prompt,
    reasoning: {
      effort: resolvedSettings.reasoningEffort,
    },
    text: requestConfig.text as never,
    ...(requestConfig.instructions ? { instructions: requestConfig.instructions } : {}),
    ...(resolvedSettings.maxOutputTokens !== null ? { max_output_tokens: resolvedSettings.maxOutputTokens } : {}),
  });

  if (!response.output_text) {
    throw createProviderError("PROVIDER_ERROR", "OpenAI returned no text output.");
  }

  return [
    buildTextOutput(
      input,
      {
        textOutputTarget: resolvedSettings.textOutputTarget,
        outputFormat: resolvedSettings.outputFormat,
        maxOutputTokens: resolvedSettings.maxOutputTokens,
        responseId: response.id,
        responseStatus: response.status,
        usage: response.usage,
        metadata: {
          verbosity: resolvedSettings.verbosity,
          reasoningEffort: resolvedSettings.reasoningEffort,
        },
      },
      response.output_text
    ),
  ];
}

async function submitGeminiText(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = await getResolvedProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  if (!model.capabilities.runnable) {
    throw createProviderError("CONFIG_ERROR", model.capabilities.accessMessage || `${model.displayName} is not runnable right now.`);
  }

  const prompt = input.payload.prompt.trim();
  if (!prompt) {
    throw createProviderError("INVALID_INPUT", "Connect a prompt note or enter a prompt before running.");
  }

  if (input.inputAssets.length > 0 || input.payload.inputImageAssetIds.length > 0) {
    throw createProviderError("INVALID_INPUT", "Disconnect image inputs before running Gemini text generation.");
  }

  const resolvedSettings = resolveGeminiTextSettings(input.payload.settings, input.modelId);
  if (resolvedSettings.validationError) {
    throw createProviderError("INVALID_INPUT", resolvedSettings.validationError);
  }

  try {
    const ai = await getGoogleGeminiClient();
    const requestConfig = buildGeminiTextRequestConfig(resolvedSettings);
    const response = await ai.models.generateContent({
      model: input.modelId,
      contents: prompt,
      config: requestConfig,
    });
    const text = extractGoogleGeminiText(response);

    if (!text) {
      throw createProviderError("PROVIDER_ERROR", "Gemini returned no text output.");
    }

    return [
      buildTextOutput(
        input,
        {
          textOutputTarget: resolvedSettings.textOutputTarget,
          outputFormat: resolvedSettings.textOutputTarget === "note" ? "text" : "json_schema",
          maxOutputTokens: resolvedSettings.maxOutputTokens,
          metadata: {
            providerResponseModality: resolvedSettings.textOutputTarget === "note" ? "TEXT" : "JSON",
          },
        },
        text
      ),
    ];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    const classified = classifyGoogleGeminiError(error);
    throw createProviderError(classified.code, classified.message, {
      ...classified.details,
      retryable: classified.retryable,
      accessUpdate: classified.accessUpdate,
    });
  }
}

async function submitGeminiImage(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = await getResolvedProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  if (!model.capabilities.runnable) {
    throw createProviderError("CONFIG_ERROR", model.capabilities.accessMessage || `${model.displayName} is not runnable right now.`);
  }

  const prompt = input.payload.prompt.trim();
  if (!prompt) {
    throw createProviderError("INVALID_INPUT", "Connect a prompt note or enter a prompt before running.");
  }

  const executionMode = readExecutionMode(input.payload.executionMode);
  const acceptedMimeTypes = new Set(model.capabilities.acceptedInputMimeTypes);
  const inputAssets = input.inputAssets
    .filter((asset) => asset.type === "image" && acceptedMimeTypes.has(asset.mimeType))
    .slice(0, model.capabilities.maxInputImages);

  if (executionMode === "generate" && inputAssets.length > 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Disconnect image inputs or switch the node to Edit mode before running."
    );
  }

  if (executionMode === "edit" && inputAssets.length === 0) {
    throw createProviderError(
      "INVALID_INPUT",
      "Connect at least one PNG, JPEG, or WebP image input before running."
    );
  }

  try {
    const ai = await getGoogleGeminiClient();
    const { resolved, config } = buildGeminiImageGenerateConfig(input.payload.settings, input.modelId);
    const response = await ai.models.generateContent({
      model: input.modelId,
      contents: buildGoogleGeminiContents(prompt, inputAssets),
      config,
    });
    return buildGeminiImageOutputsFromResponse({
      job: input,
      executionMode,
      resolvedSettings: resolved,
      response,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    const classified = classifyGoogleGeminiError(error);
    throw createProviderError(classified.code, classified.message, {
      ...classified.details,
      retryable: classified.retryable,
      accessUpdate: classified.accessUpdate,
    });
  }
}

async function submitTopazGigapixel(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  const model = await getResolvedProviderModelDescriptor(input.providerId, input.modelId);
  if (!model) {
    throw createProviderError("INVALID_INPUT", `Unknown provider model: ${input.providerId}/${input.modelId}`);
  }

  if (model.capabilities.availability !== "ready") {
    throw createProviderError("COMING_SOON", `${model.displayName} is not runnable yet.`);
  }

  const missingRequirement = getFirstUnconfiguredRequirement(model.capabilities);
  if (missingRequirement) {
    throw createProviderError(
      "CONFIG_ERROR",
      `Topaz is not configured. Save ${missingRequirement.key} in Settings or set it in .env.local and restart the app.`
    );
  }

  const imageInputs = input.inputAssets
    .filter((asset) => asset.type === "image" && model.capabilities.acceptedInputMimeTypes.includes(asset.mimeType))
    .slice(0, model.capabilities.maxInputImages);

  if (imageInputs.length !== 1) {
    throw createProviderError(
      "INVALID_INPUT",
      "Topaz requires exactly one connected PNG, JPEG, or TIFF image input."
    );
  }

  const prompt = input.payload.prompt.trim();
  const promptMode = model.capabilities.promptMode;
  if (promptMode === "unsupported" && prompt) {
    throw createProviderError("INVALID_INPUT", `${model.displayName} does not support prompt input.`);
  }

  const { output, request, response } = await executeTopazImageApi({
    modelId: input.modelId,
    prompt,
    settings: input.payload.settings,
    inputAsset: imageInputs[0],
  });

  return [
    {
      ...output,
      metadata: {
        ...output.metadata,
        topazApiRequest: request,
        topazApiResponse: response,
      },
    },
  ];
}

async function submitOpenAiJob(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  if (isRunnableOpenAiImageModel(input.providerId, input.modelId)) {
    return submitOpenAiImage(input);
  }

  if (isRunnableOpenAiTextModel(input.providerId, input.modelId)) {
    return submitOpenAiText(input);
  }

  const model = getProviderModelDescriptor(input.providerId, input.modelId);
  const label = model?.displayName || `${input.providerId}/${input.modelId}`;
  throw createProviderError("COMING_SOON", `${label} is coming soon.`);
}

async function submitGeminiJob(input: ProviderJobInput): Promise<NormalizedOutput[]> {
  if (isRunnableGeminiImageModel(input.providerId, input.modelId)) {
    return submitGeminiImage(input);
  }

  if (isRunnableGeminiTextModel(input.providerId, input.modelId)) {
    return submitGeminiText(input);
  }

  const model = getProviderModelDescriptor(input.providerId, input.modelId);
  const label = model?.displayName || `${input.providerId}/${input.modelId}`;
  throw createProviderError("COMING_SOON", `${label} is coming soon.`);
}

const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: {
    providerId: "openai",
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: true,
      nodeKinds: ["image-gen", "text-gen"],
    }),
    getModels: () => buildProviderCatalog().openai,
    submitJob: submitOpenAiJob,
  },
  "google-gemini": {
    providerId: "google-gemini",
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: false,
      nodeKinds: ["image-gen", "text-gen"],
    }),
    getModels: () => buildProviderCatalog()["google-gemini"],
    submitJob: submitGeminiJob,
  },
  topaz: {
    providerId: "topaz",
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: false,
      nodeKinds: ["transform"],
    }),
    getModels: () => buildProviderCatalog().topaz,
    submitJob: submitTopazGigapixel,
  },
};

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return adapters[providerId];
}

export async function getProviderModel(providerId: ProviderId, modelId: string): Promise<ProviderModelDescriptor | null> {
  return getResolvedProviderModelDescriptor(providerId, modelId);
}

export async function getAllProviderModels(): Promise<ProviderModelDescriptor[]> {
  const catalog = buildProviderCatalog();
  const models = [...catalog.openai, ...catalog["google-gemini"], ...catalog.topaz];
  return Promise.all(models.map((model) => resolveProviderModelCredentials(model)));
}
