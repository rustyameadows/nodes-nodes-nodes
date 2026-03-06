import type { ModelParameterDefinition } from "@/lib/model-parameters";

export type ProviderId = "openai" | "google-gemini" | "topaz";
export type NodeKind = "text-gen" | "image-gen" | "video-gen" | "transform";
export type OutputType = "text" | "image" | "video";
export type ProviderModelAvailability = "ready" | "coming_soon";
export type OpenAIImageMode = "generate" | "edit";
export type ProviderRequirementKind = "env" | "executable";
export type ProviderPromptMode = "required" | "optional" | "unsupported";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageInputFidelity = "high" | "low";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageModeration = "auto" | "low";

export type ProviderRequirement = {
  kind: ProviderRequirementKind;
  key: string;
  configured: boolean;
  label: string;
};

export type ProviderModelCapabilities = {
  text: boolean;
  image: boolean;
  video: boolean;
  runnable: boolean;
  availability: ProviderModelAvailability;
  requiresApiKeyEnv: string | null;
  apiKeyConfigured: boolean;
  requirements: ProviderRequirement[];
  promptMode: ProviderPromptMode;
  executionModes: OpenAIImageMode[];
  acceptedInputMimeTypes: string[];
  maxInputImages: number;
  parameters: ModelParameterDefinition[];
  defaults: Record<string, unknown>;
};

export type NodePayload = {
  nodeId: string;
  nodeType: NodeKind;
  prompt: string;
  settings: Record<string, unknown>;
  outputType: OutputType;
  executionMode: OpenAIImageMode;
  outputCount: number;
  promptSourceNodeId?: string | null;
  upstreamNodeIds: string[];
  upstreamAssetIds: string[];
  inputImageAssetIds: string[];
};

export type ProviderInputAsset = {
  assetId: string;
  type: OutputType;
  storageRef: string;
  mimeType: string;
  buffer: Buffer;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

export type ProviderJobInput = {
  projectId: string;
  jobId: string;
  providerId: ProviderId;
  modelId: string;
  payload: NodePayload;
  inputAssets: ProviderInputAsset[];
  onPreviewFrame?: (previewFrame: NormalizedPreviewFrame) => Promise<void> | void;
};

export type NormalizedOutput = {
  type: OutputType;
  mimeType: string;
  metadata: Record<string, unknown>;
  content: string | Buffer;
  encoding: BufferEncoding | "binary";
  extension: string;
};

export type NormalizedPreviewFrame = {
  outputIndex: number;
  previewIndex: number;
  mimeType: string;
  extension: string;
  content: Buffer;
  metadata: {
    width?: number | null;
    height?: number | null;
  };
};

export type ProviderModelDescriptor = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ProviderModelCapabilities;
  defaultSettings: Record<string, unknown>;
};

export type ProviderCapabilities = {
  supportsCancel: boolean;
  supportsStreaming: boolean;
  nodeKinds: NodeKind[];
};

export type ProviderAdapter = {
  providerId: ProviderId;
  getCapabilities: () => ProviderCapabilities;
  getModels: () => ProviderModelDescriptor[];
  submitJob: (input: ProviderJobInput) => Promise<NormalizedOutput[]>;
};

export type ProjectFilterState = {
  type?: OutputType | "all";
  ratingAtLeast?: number;
  flaggedOnly?: boolean;
  tag?: string;
  providerId?: ProviderId | "all";
  sort?: "newest" | "oldest" | "rating";
};
