import { Prisma } from "@prisma/client";
import { buildOpenAiImageDebugRequest } from "@/lib/openai-image-settings";
import { prisma } from "@/lib/prisma";
import { getProviderAdapter } from "@/lib/providers/registry";
import { readAssetContent, saveBufferAsAsset, saveContentAsAsset } from "@/lib/storage/local-storage";
import type { NodePayload, NormalizedPreviewFrame, ProviderId } from "@/lib/types";

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
    promptSourceNodeId: raw.promptSourceNodeId ? String(raw.promptSourceNodeId) : null,
    upstreamNodeIds: Array.isArray(raw.upstreamNodeIds)
      ? raw.upstreamNodeIds.map((id) => String(id))
      : [],
    upstreamAssetIds: Array.isArray(raw.upstreamAssetIds)
      ? raw.upstreamAssetIds.map((id) => String(id))
      : [],
    inputImageAssetIds: Array.isArray(raw.inputImageAssetIds)
      ? raw.inputImageAssetIds.map((id) => String(id))
      : [],
  };
}

function toErrorMessage(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : "Provider execution error",
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

  const uniqueAssetIds = [...new Set(inputImageAssetIds)];
  const assets = await prisma.asset.findMany({
    where: {
      projectId,
      id: {
        in: uniqueAssetIds,
      },
    },
  });

  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const orderedAssets = uniqueAssetIds
    .map((assetId) => assetMap.get(assetId))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));

  return Promise.all(
    orderedAssets.map(async (asset) => ({
      assetId: asset.id,
      type: asset.type,
      storageRef: asset.storageRef,
      mimeType: asset.mimeType,
      buffer: await readAssetContent(asset.storageRef),
      checksum: asset.checksum,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
    }))
  );
}

function buildProviderRequest(
  providerId: ProviderId,
  modelId: string,
  payload: NodePayload,
  inputAssets: Awaited<ReturnType<typeof loadInputAssets>>
) {
  const providerRequestPreview =
    providerId === "openai"
      ? buildOpenAiImageDebugRequest({
          modelId,
          prompt: payload.prompt,
          executionMode: payload.executionMode,
          rawSettings: payload.settings,
          inputImageAssetIds: payload.inputImageAssetIds,
        })
      : null;

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
  } as Prisma.InputJsonValue;
}

function extensionForPreviewMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

async function persistPreviewFrame(projectId: string, jobId: string, previewFrame: NormalizedPreviewFrame) {
  const stored = await saveBufferAsAsset(
    projectId,
    previewFrame.extension || extensionForPreviewMimeType(previewFrame.mimeType),
    previewFrame.content
  );

  return prisma.jobPreviewFrame.create({
    data: {
      jobId,
      outputIndex: previewFrame.outputIndex,
      previewIndex: previewFrame.previewIndex,
      storageRef: stored.storageRef,
      mimeType: previewFrame.mimeType,
      width: typeof previewFrame.metadata.width === "number" ? previewFrame.metadata.width : null,
      height: typeof previewFrame.metadata.height === "number" ? previewFrame.metadata.height : null,
    },
  });
}

export async function processJobById(jobId: string) {
  const existing = await prisma.job.findUnique({ where: { id: jobId } });
  if (!existing || existing.state !== "queued") {
    return;
  }

  const attemptNumber = existing.attempts + 1;
  const payload = asNodePayload(existing.nodeRunPayload);
  const providerId = existing.providerId as ProviderId;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      state: "running",
      startedAt: new Date(),
      attempts: attemptNumber,
      errorCode: null,
      errorMessage: null,
    },
  });
  await prisma.jobPreviewFrame.deleteMany({
    where: { jobId },
  });

  const start = Date.now();
  let inputAssets: Awaited<ReturnType<typeof loadInputAssets>> = [];
  const persistedPreviewFrames: Array<{
    id: string;
    outputIndex: number;
    previewIndex: number;
    mimeType: string;
    createdAt: Date;
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

    await prisma.jobAttempt.create({
      data: {
        jobId,
        attemptNumber,
        providerRequest: buildProviderRequest(providerId, existing.modelId, payload, inputAssets),
        providerResponse: {
          outputCount: outputs.length,
          outputTypes: outputs.map((output) => output.type),
          outputs: outputs.map((output) => ({
            type: output.type,
            mimeType: output.mimeType,
            extension: output.extension,
            metadata: output.metadata,
          })),
          previewFrameCount: persistedPreviewFrames.length,
          previewFrames: persistedPreviewFrames.map((previewFrame) => ({
            id: previewFrame.id,
            outputIndex: previewFrame.outputIndex,
            previewIndex: previewFrame.previewIndex,
            mimeType: previewFrame.mimeType,
            createdAt: previewFrame.createdAt,
          })),
        } as Prisma.InputJsonValue,
        durationMs: Date.now() - start,
      },
    });

    for (const output of outputs) {
      const stored = Buffer.isBuffer(output.content)
        ? await saveBufferAsAsset(existing.projectId, output.extension, output.content)
        : await saveContentAsAsset(existing.projectId, output.extension, output.content, output.encoding);
      const width = typeof output.metadata.width === "number" ? output.metadata.width : null;
      const height = typeof output.metadata.height === "number" ? output.metadata.height : null;
      const durationMs = typeof output.metadata.durationMs === "number" ? output.metadata.durationMs : null;

      const asset = await prisma.asset.create({
        data: {
          projectId: existing.projectId,
          jobId,
          type: output.type,
          storageRef: stored.storageRef,
          mimeType: output.mimeType,
          width,
          height,
          durationMs,
          checksum: stored.checksum,
          outputIndex: typeof output.metadata.outputIndex === "number" ? output.metadata.outputIndex : null,
        },
      });

      await prisma.assetFeedback.create({
        data: {
          assetId: asset.id,
          rating: null,
          flagged: false,
        },
      });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        state: "succeeded",
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const { code, message } = toErrorMessage(error);

    await prisma.jobAttempt.create({
      data: {
        jobId,
        attemptNumber,
        providerRequest: buildProviderRequest(providerId, existing.modelId, payload, inputAssets),
        providerResponse:
          persistedPreviewFrames.length > 0
            ? ({
                previewFrameCount: persistedPreviewFrames.length,
                previewFrames: persistedPreviewFrames.map((previewFrame) => ({
                  id: previewFrame.id,
                  outputIndex: previewFrame.outputIndex,
                  previewIndex: previewFrame.previewIndex,
                  mimeType: previewFrame.mimeType,
                  createdAt: previewFrame.createdAt,
                })),
              } as Prisma.InputJsonValue)
            : undefined,
        errorCode: code,
        errorMessage: message,
        durationMs: Date.now() - start,
      },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        state: "failed",
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
      },
    });
  }
}
