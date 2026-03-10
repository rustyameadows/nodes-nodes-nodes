# Provider Integrations (Desktop Runtime)

## Goals
- Keep provider execution behind one adapter boundary.
- Snapshot concrete graph inputs before queueing a job.
- Normalize outputs so the renderer never needs provider-specific transport logic.

## Current Provider Status
- `openai / gpt-image-1.5`
- `openai / gpt-image-1-mini`
  - runnable image generation and image edit/reference flows
- `openai / gpt-5.4`
- `openai / gpt-5-mini`
- `openai / gpt-5-nano`
  - runnable text-generation flows through the Responses API
- `google-gemini / gemini-2.5-flash-image`
- `google-gemini / gemini-3-pro-image-preview`
- `google-gemini / gemini-3.1-flash-image-preview`
  - runnable Gemini image generation and single-image edit/reference flows through `ai.models.generateContent`
- `google-gemini / gemini-3.1-flash-lite-preview`
- `google-gemini / gemini-3-flash-preview`
- `google-gemini / gemini-2.5-pro`
- `google-gemini / gemini-2.5-flash`
- `google-gemini / gemini-2.5-flash-lite`
  - runnable Gemini text-generation flows through `ai.models.generateContent`
- `topaz / high_fidelity_v2`
- `topaz / redefine`
  - runnable Topaz image transforms

## Runtime Contract

```ts
type ProviderJobInput = {
  projectId: string;
  jobId: string;
  providerId: "openai" | "google-gemini" | "topaz";
  modelId: string;
  payload: NodePayload;
  inputAssets: ProviderInputAsset[];
  onPreviewFrame?: (previewFrame: NormalizedPreviewFrame) => Promise<void> | void;
};
```

Provider adapters return normalized outputs:
- image/video buffers for persisted assets
- inline text for GPT text responses plus parsed generated-node descriptors in worker-owned attempt metadata
- preview frames when streaming is supported

## Capability Metadata
`provider_models.capabilities` stores the renderer-facing metadata needed for honest UI gating:
- `runnable`
- `availability`
- `billingAvailability`
- `accessStatus`
- `accessReason`
- `accessMessage`
- `lastCheckedAt`
- `requirements`
- `promptMode`
- `requiresApiKeyEnv`
- `apiKeyConfigured`
- `executionModes`
- `acceptedInputMimeTypes`
- `maxInputImages`
- `parameters`
- `defaults`

Gemini uses a hybrid access model:
- static billing hints are copied from the Google pricing page into `billingAvailability`
- dynamic project access is refreshed from `models.list()` using the saved `GOOGLE_API_KEY`
- runtime provider errors remain authoritative for billing, permission, quota, and rate-limit failures

Gemini access refresh outcomes:
- listed by Gemini -> `accessStatus=available`
- missing key -> `accessStatus=blocked`, `accessReason=missing_key`
- key configured but model not listed -> `accessStatus=blocked`, `accessReason=not_listed`
- probe failed -> `accessStatus=unknown`, `accessReason=probe_failed`

Runtime Gemini failures update cached access state:
- billing required, permission denied, not listed, invalid input -> blocked and non-retryable
- quota exhausted -> limited and non-retryable
- rate limited, temporary unavailable -> limited and retryable

## Environment Keys
The renderer never receives these values directly:

```bash
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

Credential resolution order:
1. macOS Keychain values saved from App Settings
2. `.env` / `.env.local` values loaded into `process.env`

Read locations:
- main process
- worker process
- provider adapters

Renderer-facing credential APIs:
- `listProviderCredentials()`
- `saveProviderCredential(key, value)`
- `clearProviderCredential(key)`
- `refreshProviderAccess(providerId?)`

Renderer credential state includes:
- `configured`
- `source`: `keychain`, `environment`, or `none`

The packaged app can be fully configured from Finder without editing repo env files. In source-run development, `.env.local` remains supported.

## OpenAI Image Jobs
- support prompt-only `generate` and reference-image `edit`
- execution mode is inferred from connected image inputs
- request settings are resolved before enqueue
- partial previews are persisted as `job_preview_frames`
- final outputs become `assets` rows plus local files

## OpenAI And Gemini Text Jobs
- accept prompt text only
- support four output targets:
  - `Text Note`
  - `List`
  - `Template`
  - `Smart Output`
- `Text Note` remains the default and is fully backward compatible
- `List`, `Template`, and `Smart Output` force app-owned strict structured output:
  - OpenAI uses Responses API text formats
  - Gemini uses `responseMimeType=application/json` plus `responseJsonSchema`
- structured parsing happens in the worker/job pipeline, never in the renderer
- `List` and `Template` create one deterministic generated placeholder node while queued/running
- `Smart Output` spawns one or more unconnected generated nodes only after parsed descriptors are available
- `Smart Output` follows explicit user instructions about node types first, and only falls back to the general node-selection rules when the prompt is ambiguous
- parse failure still marks the job successful and falls back to one generated `text-note`
- persist returned text plus parsed generated-node descriptors in `job_attempts.provider_response`
- do not create asset rows or asset files
- Gemini text settings are model-aware instead of globally minimal:
  - shared Gemini text controls: `textOutputTarget`, `maxOutputTokens`, `temperature`, `topP`, `topK`
  - Gemini 3 flash-family models also expose `thinkingLevel`
  - Gemini 2.5-family models also expose `thinkingBudget`
- Gemini intentionally does not expose broader text knobs like `candidateCount`, penalties, `seed`, `stopSequences`, `responseLogprobs`, `logprobs`, `includeThoughts`, or `mediaResolution` in this pass

## Gemini Image Jobs
- support prompt-only `generate` and single-image `edit`
- use `ai.models.generateContent` with image response modality
- accept PNG, JPEG, and WebP inputs
- persist every returned Gemini image part as a generated image output in provider order
- do not stream preview frames in this pass
- shared Gemini image controls: `temperature`, `aspectRatio`, `maxOutputTokens`, `topP`, `stopSequences`
- `gemini-2.5-flash-image` exposes only the shared Gemini image controls
- `gemini-3-pro-image-preview` also exposes `imageSize` (`1K`, `2K`, `4K`)
- `gemini-3.1-flash-image-preview` also exposes `outputMode` (`Images & Text` vs `Images Only`), `imageSize` (`512`, `1K`, `2K`, `4K`), and `thinkingLevel`
- `gemini-3.1-flash-image-preview` `Images Only` returns every generated image part Gemini includes in the response
- `gemini-3.1-flash-image-preview` `Images & Text` is experimental and provider-authentic: the app requests Gemini image parts plus app-owned `Smart Output` JSON text from the same provider call, but Gemini may still return image-only
- when Gemini does return mixed output, the job attempt persists both the image asset rows and the parsed generated-node descriptors in one job attempt record
- when Gemini omits text, the job remains a successful image-only mixed attempt and persists typed mixed-output diagnostics instead of synthesizing fallback smart nodes
- Gemini image nodes intentionally do not expose OpenAI-style image knobs like `outputFormat`, `quality`, `size`, `background`, `moderation`, `inputFidelity`, or multi-image output counts
- Gemini intentionally does not expose people-generation toggles, image `seed`, or tool toggles in this pass

## Topaz Jobs
- run as single-image transforms
- `high_fidelity_v2` is synchronous
- `redefine` is async and may require download-envelope resolution
- final outputs are normalized back into standard asset storage

## Failure Model
- queue attempts are persisted
- failures surface explicit error code and message
- retries use bounded backoff
- worker restarts recover stale running jobs by re-queueing them
