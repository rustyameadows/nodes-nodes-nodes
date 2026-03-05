# Provider Integrations (V1)

## Goals
- Keep provider behavior behind a single contract.
- Normalize inputs/outputs so canvas nodes remain provider-agnostic.
- Allow stable IDs and user-friendly display names.

## Canonical Providers (V1)
- `openai`
- `google-gemini`
- `topaz`

Gemini 3.1 Flash is displayed as `Nano Banana 2` in UI labels while retaining stable internal IDs.

## Public Contract

```ts
export type ProviderId = "openai" | "google-gemini" | "topaz";

export interface ProviderAdapter {
  providerId: ProviderId;
  getCapabilities(): Promise<ProviderCapabilities>;
  submitJob(input: ProviderJobInput): Promise<ProviderJobRef>;
  getJobStatus(ref: ProviderJobRef): Promise<ProviderJobStatus>;
  cancelJob(ref: ProviderJobRef): Promise<void>;
  normalizeOutputs(status: ProviderJobStatus): Promise<NormalizedOutput[]>;
}

export interface ProviderCapabilities {
  models: ModelDescriptor[];
  nodeKinds: ("text-gen" | "image-gen" | "video-gen" | "transform")[];
  supportsStreaming: boolean;
  supportsCancel: boolean;
}

export interface ModelDescriptor {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
  defaultSettings: Record<string, unknown>;
}

export interface ProviderJobInput {
  projectId: string;
  jobId: string;
  modelId: string;
  nodePayload: Record<string, unknown>;
  settings: Record<string, unknown>;
  upstreamAssets: AssetInputRef[];
}

export interface AssetInputRef {
  assetId: string;
  storageRef: string;
  mimeType: string;
}

export interface ProviderJobRef {
  providerId: ProviderId;
  externalJobId: string;
}

export interface ProviderJobStatus {
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progressPct?: number;
  errorCode?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
}

export interface NormalizedOutput {
  type: "image" | "video" | "text";
  sourceUrl?: string;
  text?: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}
```

## Node Definition Contract

```ts
export interface NodeDefinition {
  nodeType: string;
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  settingsSchema: Record<string, unknown>;
}

export interface PortSpec {
  name: string;
  mediaTypes: ("text" | "image" | "video")[];
  required: boolean;
  multiple: boolean;
}
```

## Provider Mapping Notes

### OpenAI (`openai`)
- Use OpenAI responses compatible with selected model capabilities.
- Map provider params to normalized settings structure.
- Normalize outputs to asset-ready payloads.

### Gemini 3.1 Flash (`google-gemini`)
- Internal ID example: `gemini-3.1-flash`.
- UI display name in this app: `Nano Banana 2`.
- Keep display-name override in `provider_models` table, not hardcoded in nodes.

### Topaz (`topaz`)
- Treat as equal provider in node graph.
- Expose settings/options and normalized outputs via same contract.
- Keep any provider-specific limitations as capability metadata.

## Settings and Display-Name Strategy
- Node and job execution persist `providerId` and `modelId`.
- UI label is looked up dynamically from model registry.
- Display labels can change without data migrations.

## Error Mapping
- Normalize provider errors into:
  - `AUTH_ERROR`
  - `RATE_LIMIT`
  - `INVALID_INPUT`
  - `MODEL_UNAVAILABLE`
  - `TIMEOUT`
  - `UNKNOWN_PROVIDER_ERROR`
- Persist raw provider error details in `job_attempts` for debugging.

## Retry and Idempotency
- Retries are controlled by job config (`max_attempts` default 3).
- Use deterministic idempotency key: `jobId + attemptNumber`.
- Do not duplicate assets on repeated status callbacks/polls.

## Mock Mode
- Allow local adapter mock mode for UI and workflow development.
- Mock mode still writes canonical `jobs` and `assets` records.
