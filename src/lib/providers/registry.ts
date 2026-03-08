import OpenAI, { toFile } from "openai";
import { getFirstUnconfiguredRequirement } from "@/lib/provider-readiness";
import type { ProviderCredentialKey } from "@/components/workspace/types";
import {
  resolveProviderCredential,
  resolveProviderCredentialValue,
} from "@/lib/runtime/provider-credentials";
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
import {
  getTopazExecutionModes,
  getTopazGigapixelDefaultSettings,
  getTopazGigapixelParameterDefinitions,
  getTopazPromptMode,
  normalizeLegacyTopazModelId,
  TOPAZ_GIGAPIXEL_INPUT_MIME_TYPES,
  TOPAZ_GIGAPIXEL_MAX_INPUT_IMAGES,
} from "@/lib/topaz-gigapixel-settings";
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

type ProviderErrorCode = "CONFIG_ERROR" | "COMING_SOON" | "INVALID_INPUT" | "PROVIDER_ERROR";

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
      runnable: model.capabilities.runnable && !hasMissingRequirement,
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

  const comingSoonMixedCapabilities = buildCapabilities({
    text: true,
    image: true,
    video: true,
    runnable: false,
    availability: "coming_soon",
    promptMode: "optional",
    executionModes: [],
    parameters: [],
  });

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
        modelId: "gemini-3.1-flash",
        displayName: "Nano Banana 2",
        capabilities: comingSoonMixedCapabilities,
        defaultSettings: {},
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
  resolvedSettings: ReturnType<typeof resolveOpenAiTextSettings>,
  response: {
    id: string;
    status?: string | null;
    usage?: unknown;
    output_text: string;
  }
): NormalizedOutput {
  const mimeType =
    resolvedSettings.textOutputTarget === "note" && resolvedSettings.outputFormat === "text"
      ? "text/plain"
      : "application/json";
  const extension =
    resolvedSettings.textOutputTarget === "note" && resolvedSettings.outputFormat === "text" ? "txt" : "json";

  return {
    type: "text",
    mimeType,
    extension,
    encoding: "utf-8",
    metadata: {
      providerId: input.providerId,
      modelId: input.modelId,
      outputIndex: 0,
      responseId: response.id,
      responseStatus: response.status,
      textOutputTarget: resolvedSettings.textOutputTarget,
      outputFormat: resolvedSettings.outputFormat,
      verbosity: resolvedSettings.verbosity,
      reasoningEffort: resolvedSettings.reasoningEffort,
      maxOutputTokens: resolvedSettings.maxOutputTokens,
      usage: response.usage || null,
    },
    content: response.output_text,
  };
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
    text: requestConfig.text,
    ...(requestConfig.instructions ? { instructions: requestConfig.instructions } : {}),
    ...(resolvedSettings.maxOutputTokens !== null ? { max_output_tokens: resolvedSettings.maxOutputTokens } : {}),
  });

  if (!response.output_text) {
    throw createProviderError("PROVIDER_ERROR", "OpenAI returned no text output.");
  }

  return [buildTextOutput(input, resolvedSettings, response)];
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

function buildComingSoonAdapter(providerId: ProviderId): ProviderAdapter {
  return {
    providerId,
    getCapabilities: () => ({
      supportsCancel: false,
      supportsStreaming: false,
      nodeKinds: ["text-gen", "image-gen", "video-gen", "transform"],
    }),
    getModels: () => buildProviderCatalog()[providerId],
    submitJob: async (input) => {
      const model = getProviderModelDescriptor(input.providerId, input.modelId);
      const label = model?.displayName || `${input.providerId}/${input.modelId}`;
      throw createProviderError("COMING_SOON", `${label} is coming soon.`);
    },
  };
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
  "google-gemini": buildComingSoonAdapter("google-gemini"),
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
