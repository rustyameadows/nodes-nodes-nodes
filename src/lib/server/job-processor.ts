import { and, eq, inArray } from "drizzle-orm";
import { getImageDimensions } from "@/lib/image-dimensions";
import {
  createGeneratedTextNoteDescriptorsFromRawText,
  parseStructuredTextOutput,
} from "@/lib/generated-text-output";
import { getDb } from "@/lib/db/client";
import { assets, jobAttempts, jobPreviewFrames, jobs } from "@/lib/db/schema";
import { getGeminiMixedOutputDiagnosticsFromOutputs } from "@/lib/gemini-mixed-output";
import { getProviderAdapter } from "@/lib/providers/registry";
import { createImportedAsset } from "@/lib/services/assets";
import { nowIso, newId } from "@/lib/services/common";
import { updateProviderModelAccessState } from "@/lib/services/providers";
import { readAssetContent, saveBufferAsPreview } from "@/lib/storage/local-storage";
import { isStructuredTextOutputTarget, readOpenAiTextOutputTarget } from "@/lib/text-output-targets";
import type { NodePayload, NormalizedOutput, NormalizedPreviewFrame, ProviderId } from "@/lib/types";
import { buildProviderDebugRequest } from "@/lib/provider-model-helpers";

function asNodePayload(value: unknown): NodePayload {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid node payload");
  }

  const raw = value as Record<string, unknown>;
  return {
    nodeId: String(raw.nodeId || "node"),
    nodeType: (raw.nodeType as NodePayload["nodeType"]) || "image-gen",
    prompt: String(raw.prompt || ""),
    settings: (raw.settings as Record<string, unknown>) || {},
    outputType: (raw.outputType as NodePayload["outputType"]) || "image",
    executionMode: raw.executionMode === "generate" ? "generate" : "edit",
    outputCount:
      typeof raw.outputCount === "number" && Number.isInteger(raw.outputCount) ? Math.max(1, raw.outputCount) : 1,
    runOrigin: raw.runOrigin === "copilot" ? "copilot" : "canvas-node",
    promptSourceNodeId: raw.promptSourceNodeId ? String(raw.promptSourceNodeId) : null,
    upstreamNodeIds: Array.isArray(raw.upstreamNodeIds) ? raw.upstreamNodeIds.map((id) => String(id)) : [],
    upstreamAssetIds: Array.isArray(raw.upstreamAssetIds) ? raw.upstreamAssetIds.map((id) => String(id)) : [],
    inputImageAssetIds: Array.isArray(raw.inputImageAssetIds) ? raw.inputImageAssetIds.map((id) => String(id)) : [],
  };
}

function toErrorMessage(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : "Provider execution error",
      details:
        "details" in error && error.details && typeof error.details === "object"
          ? (error.details as Record<string, unknown>)
          : undefined,
    };
  }

  if (error instanceof Error) {
    return { code: "PROVIDER_ERROR", message: error.message };
  }
  return { code: "PROVIDER_ERROR", message: "Unknown provider execution error" };
}

async function loadInputAssets(projectId: string, inputImageAssetIds: string[]) {
  if (inputImageAssetIds.length === 0) {
    return [];
  }

  const db = getDb();
  const uniqueAssetIds = [...new Set(inputImageAssetIds)];
  const assetRows = db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), inArray(assets.id, uniqueAssetIds)))
    .all();
  const assetMap = new Map(assetRows.map((asset) => [asset.id, asset]));
  const orderedAssets = uniqueAssetIds
    .map((assetId) => assetMap.get(assetId))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));

  return Promise.all(
    orderedAssets.map(async (asset) => {
      const buffer = await readAssetContent(asset.storageRef);
      const inferredDimensions =
        asset.type === "image" && (asset.width == null || asset.height == null)
          ? getImageDimensions(buffer, asset.mimeType)
          : null;

      return {
        assetId: asset.id,
        type: asset.type,
        storageRef: asset.storageRef,
        mimeType: asset.mimeType,
        buffer,
        checksum: asset.checksum,
        width: asset.width ?? inferredDimensions?.width ?? null,
        height: asset.height ?? inferredDimensions?.height ?? null,
        durationMs: asset.durationMs,
      };
    })
  );
}

function buildProviderRequest(
  providerId: ProviderId,
  modelId: string,
  payload: NodePayload,
  inputAssets: Awaited<ReturnType<typeof loadInputAssets>>
) {
  const providerRequestPreview = buildProviderDebugRequest({
    providerId,
    modelId,
    prompt: payload.prompt,
    executionMode: payload.executionMode,
    rawSettings: payload.settings,
    inputImageAssetIds: payload.inputImageAssetIds,
    inputAssets: inputAssets.map((asset) => ({
      assetId: asset.assetId,
      mimeType: asset.mimeType,
      width: asset.width ?? null,
      height: asset.height ?? null,
    })),
  });

  return {
    providerId,
    modelId,
    providerRequestPreview,
    payload,
    inputAssets: inputAssets.map((asset) => ({
      assetId: asset.assetId,
      type: asset.type,
      storageRef: asset.storageRef,
      mimeType: asset.mimeType,
      checksum: asset.checksum || null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      durationMs: asset.durationMs ?? null,
    })),
  };
}

function extensionForPreviewMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function getTextOutputs(outputs: NormalizedOutput[]) {
  return outputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output.type === "text" && typeof output.content === "string")
    .map(({ output, index }) => ({
      content: output.content as string,
      outputIndex: typeof output.metadata.outputIndex === "number" ? Number(output.metadata.outputIndex) : index,
      metadata: output.metadata,
    }));
}

function getTextOutputTargetForOutputs(
  textOutputs: ReturnType<typeof getTextOutputs>,
  fallbackTarget: ReturnType<typeof readOpenAiTextOutputTarget>
) {
  const metadataTarget = textOutputs[0]?.metadata?.textOutputTarget;
  return readOpenAiTextOutputTarget(metadataTarget, fallbackTarget);
}

export function buildGeneratedTextResultFromOutputs(input: {
  outputs: NormalizedOutput[];
  fallbackTextOutputTarget: ReturnType<typeof readOpenAiTextOutputTarget>;
  sourceJobId: string;
  sourceModelNodeId: string | null;
  runOrigin: "canvas-node" | "copilot";
}) {
  const textOutputs = getTextOutputs(input.outputs);
  const textOutputTarget = getTextOutputTargetForOutputs(textOutputs, input.fallbackTextOutputTarget);
  const generatedNodeDescriptorResult =
    textOutputs.length === 0
      ? null
      : isStructuredTextOutputTarget(textOutputTarget)
        ? parseStructuredTextOutput({
            textOutputTarget,
            content: textOutputs[0]!.content,
            sourceJobId: input.sourceJobId,
            sourceModelNodeId: input.sourceModelNodeId,
            outputIndex: textOutputs[0]!.outputIndex,
            runOrigin: input.runOrigin,
          })
        : {
            generatedNodeDescriptors: createGeneratedTextNoteDescriptorsFromRawText({
              outputs: textOutputs.map((output) => ({
                content: output.content,
                outputIndex: output.outputIndex,
              })),
              sourceJobId: input.sourceJobId,
              sourceModelNodeId: input.sourceModelNodeId,
              runOrigin: input.runOrigin,
            }),
            generatedConnections: [],
            warning: null,
          };

  return {
    textOutputs,
    textOutputTarget,
    generatedNodeDescriptorResult,
  };
}

export function buildJobAttemptProviderResponse(input: {
  outputs: NormalizedOutput[];
  persistedPreviewFrames: Array<{
    id: string;
    outputIndex: number;
    previewIndex: number;
    mimeType: string;
    createdAt: string;
  }>;
  generatedTextResult: ReturnType<typeof buildGeneratedTextResultFromOutputs>;
  topazApiMetadata: {
    request: Record<string, unknown> | null;
    response: Record<string, unknown> | null;
  } | null;
}) {
  const geminiMixedOutputDiagnostics = getGeminiMixedOutputDiagnosticsFromOutputs(input.outputs);

  return {
    outputCount: input.outputs.length,
    outputTypes: input.outputs.map((output) => output.type),
    outputs: input.outputs.map((output) => ({
      type: output.type,
      mimeType: output.mimeType,
      extension: output.extension,
      metadata: output.metadata,
      ...(output.type === "text" && typeof output.content === "string" ? { content: output.content } : {}),
    })),
    previewFrameCount: input.persistedPreviewFrames.length,
    previewFrames: input.persistedPreviewFrames.map((previewFrame) => ({
      id: previewFrame.id,
      outputIndex: previewFrame.outputIndex,
      previewIndex: previewFrame.previewIndex,
      mimeType: previewFrame.mimeType,
      createdAt: previewFrame.createdAt,
    })),
    ...(input.generatedTextResult.generatedNodeDescriptorResult
      ? {
          textOutputTarget: input.generatedTextResult.textOutputTarget,
          generatedNodeDescriptors: input.generatedTextResult.generatedNodeDescriptorResult.generatedNodeDescriptors,
          generatedConnections: input.generatedTextResult.generatedNodeDescriptorResult.generatedConnections,
          generatedNodeDescriptorWarning: input.generatedTextResult.generatedNodeDescriptorResult.warning,
        }
      : {}),
    ...(geminiMixedOutputDiagnostics ? { mixedOutputDiagnostics: geminiMixedOutputDiagnostics } : {}),
    ...(input.topazApiMetadata ? { topazApi: input.topazApiMetadata } : {}),
  };
}

async function persistPreviewFrame(projectId: string, jobId: string, previewFrame: NormalizedPreviewFrame) {
  const db = getDb();
  const stored = await saveBufferAsPreview(
    jobId,
    previewFrame.extension || extensionForPreviewMimeType(previewFrame.mimeType),
    previewFrame.content
  );
  const id = newId();

  db.insert(jobPreviewFrames)
    .values({
      id,
      jobId,
      outputIndex: previewFrame.outputIndex,
      previewIndex: previewFrame.previewIndex,
      storageRef: stored.storageRef,
      mimeType: previewFrame.mimeType,
      width: typeof previewFrame.metadata.width === "number" ? previewFrame.metadata.width : null,
      height: typeof previewFrame.metadata.height === "number" ? previewFrame.metadata.height : null,
      createdAt: nowIso(),
    })
    .run();

  return db.select().from(jobPreviewFrames).where(eq(jobPreviewFrames.id, id)).get()!;
}

export async function processJobById(jobId: string) {
  const db = getDb();
  const existing = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!existing || (existing.state !== "queued" && existing.state !== "running")) {
    return;
  }

  const attemptNumber = existing.attempts + 1;
  const payload = asNodePayload(existing.nodeRunPayload);
  const providerId = existing.providerId as ProviderId;

  db.update(jobs)
    .set({
      state: "running",
      startedAt: existing.startedAt || nowIso(),
      attempts: attemptNumber,
      errorCode: null,
      errorMessage: null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, jobId))
    .run();
  db.delete(jobPreviewFrames).where(eq(jobPreviewFrames.jobId, jobId)).run();

  const start = Date.now();
  let inputAssets: Awaited<ReturnType<typeof loadInputAssets>> = [];
  const persistedPreviewFrames: Array<{
    id: string;
    outputIndex: number;
    previewIndex: number;
    mimeType: string;
    createdAt: string;
  }> = [];

  try {
    inputAssets = await loadInputAssets(existing.projectId, payload.inputImageAssetIds);
    const adapter = getProviderAdapter(providerId);
    const outputs = await adapter.submitJob({
      projectId: existing.projectId,
      jobId,
      providerId,
      modelId: existing.modelId,
      payload,
      inputAssets,
      onPreviewFrame: async (previewFrame) => {
        const persisted = await persistPreviewFrame(existing.projectId, jobId, previewFrame);
        persistedPreviewFrames.push({
          id: persisted.id,
          outputIndex: persisted.outputIndex,
          previewIndex: persisted.previewIndex,
          mimeType: persisted.mimeType,
          createdAt: persisted.createdAt,
        });
      },
    });

    const topazApiMetadata =
      providerId === "topaz" && outputs[0]?.metadata && typeof outputs[0].metadata === "object"
        ? {
            request:
              "topazApiRequest" in outputs[0].metadata
                ? (outputs[0].metadata.topazApiRequest as Record<string, unknown>)
                : null,
            response:
              "topazApiResponse" in outputs[0].metadata
                ? (outputs[0].metadata.topazApiResponse as Record<string, unknown>)
                : null,
          }
        : null;
    const generatedTextResult = buildGeneratedTextResultFromOutputs({
      outputs,
      fallbackTextOutputTarget: readOpenAiTextOutputTarget(payload.settings.textOutputTarget),
      sourceJobId: jobId,
      sourceModelNodeId: payload.runOrigin === "copilot" ? null : payload.nodeId,
      runOrigin: payload.runOrigin,
    });

    db.insert(jobAttempts)
      .values({
        id: newId(),
        jobId,
        attemptNumber,
        providerRequest: buildProviderRequest(providerId, existing.modelId, payload, inputAssets),
        providerResponse: buildJobAttemptProviderResponse({
          outputs,
          persistedPreviewFrames,
          generatedTextResult,
          topazApiMetadata,
        }),
        durationMs: Date.now() - start,
        createdAt: nowIso(),
      })
      .run();

    for (const [index, output] of outputs.entries()) {
      if (output.type === "text") {
        continue;
      }

      const outputBuffer = Buffer.isBuffer(output.content)
        ? output.content
        : Buffer.from(output.content, output.encoding === "binary" ? undefined : output.encoding);
      const outputIndex = typeof output.metadata.outputIndex === "number" ? output.metadata.outputIndex : index;
      await createImportedAsset(
        existing.projectId,
        {
          name: `${jobId}-${outputIndex}.${output.extension}`,
          mimeType: output.mimeType,
          buffer: outputBuffer,
        },
        jobId,
        outputIndex
      );
    }

    db.update(jobs)
      .set({
        state: "succeeded",
        finishedAt: nowIso(),
        claimedAt: null,
        claimToken: null,
        lastHeartbeatAt: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId))
      .run();
  } catch (error) {
    const { code, message, details } = toErrorMessage(error);
    const retryable =
      details && typeof details === "object" && "retryable" in details ? Boolean(details.retryable) : true;
    const accessUpdate =
      details && typeof details === "object" && "accessUpdate" in details && details.accessUpdate && typeof details.accessUpdate === "object"
        ? (details.accessUpdate as {
            accessStatus: "available" | "blocked" | "limited" | "unknown";
            accessReason:
              | "missing_key"
              | "not_listed"
              | "billing_required"
              | "permission_denied"
              | "quota_exhausted"
              | "rate_limited"
              | "temporary_unavailable"
              | "invalid_input"
              | "probe_failed"
              | null;
            accessMessage: string | null;
          })
        : null;
    const shouldRetry = retryable && attemptNumber < existing.maxAttempts;
    const nextAvailableAt = new Date(Date.now() + Math.min(30_000, Math.pow(2, attemptNumber) * 1_000)).toISOString();

    if (accessUpdate) {
      await updateProviderModelAccessState(providerId, existing.modelId, accessUpdate);
    }

    db.insert(jobAttempts)
      .values({
        id: newId(),
        jobId,
        attemptNumber,
        providerRequest: buildProviderRequest(providerId, existing.modelId, payload, inputAssets),
        providerResponse:
          persistedPreviewFrames.length > 0
            ? {
                previewFrameCount: persistedPreviewFrames.length,
                previewFrames: persistedPreviewFrames.map((previewFrame) => ({
                  id: previewFrame.id,
                  outputIndex: previewFrame.outputIndex,
                  previewIndex: previewFrame.previewIndex,
                  mimeType: previewFrame.mimeType,
                  createdAt: previewFrame.createdAt,
                })),
                ...(details ? { errorDetails: details } : {}),
              }
            : details
              ? { errorDetails: details }
              : null,
        errorCode: code,
        errorMessage: message,
        durationMs: Date.now() - start,
        createdAt: nowIso(),
      })
      .run();

    db.update(jobs)
      .set({
        state: shouldRetry ? "queued" : "failed",
        errorCode: code,
        errorMessage: message,
        finishedAt: shouldRetry ? null : nowIso(),
        availableAt: shouldRetry ? nextAvailableAt : nowIso(),
        claimedAt: null,
        claimToken: null,
        lastHeartbeatAt: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId))
      .run();
  }
}
