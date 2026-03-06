import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isRunnableOpenAiImageModel, resolveOpenAiImageSettings } from "@/lib/openai-image-settings";
import { formatProviderRequirementMessage, getFirstUnconfiguredRequirement } from "@/lib/provider-readiness";
import { prisma } from "@/lib/prisma";
import { getProviderModel } from "@/lib/providers/registry";
import { badRequest, internalError } from "@/lib/server/http";
import { dispatchJob } from "@/lib/server/job-dispatch";
import { syncProviderModels } from "@/lib/server/provider-models";
import { isRunnableTopazGigapixelModel, resolveTopazGigapixelSettings } from "@/lib/topaz-gigapixel-settings";
import type { OpenAIImageMode } from "@/lib/types";

const createJobSchema = z.object({
  providerId: z.enum(["openai", "google-gemini", "topaz"]),
  modelId: z.string().min(1),
  nodePayload: z.object({
    nodeId: z.string().min(1),
    nodeType: z.enum(["text-gen", "image-gen", "video-gen", "transform"]),
    prompt: z.string().default(""),
    settings: z.record(z.string(), z.unknown()).default({}),
    outputType: z.enum(["text", "image", "video"]),
    executionMode: z.enum(["generate", "edit"]).default("edit"),
    outputCount: z.number().int().min(1).max(4).default(1),
    promptSourceNodeId: z.string().nullable().optional(),
    upstreamNodeIds: z.array(z.string()).default([]),
    upstreamAssetIds: z.array(z.string()).default([]),
    inputImageAssetIds: z.array(z.string()).default([]),
  }),
});

function getSubmissionError(input: z.infer<typeof createJobSchema>) {
  const model = getProviderModel(input.providerId, input.modelId);
  if (!model) {
    return "Unknown provider/model selection.";
  }

  if (model.capabilities.availability !== "ready") {
    return `${model.displayName} is coming soon.`;
  }

  const missingRequirement = getFirstUnconfiguredRequirement(model.capabilities);
  if (missingRequirement) {
    return formatProviderRequirementMessage(missingRequirement) || `${model.displayName} is not runnable right now.`;
  }

  if (!model.capabilities.runnable) {
    return `${model.displayName} is not runnable right now.`;
  }

  const executionMode = input.nodePayload.executionMode as OpenAIImageMode;
  if (!model.capabilities.executionModes.includes(executionMode)) {
    return `${model.displayName} does not support ${executionMode} mode.`;
  }

  if (model.capabilities.promptMode === "required" && !input.nodePayload.prompt.trim()) {
    return "Connect a prompt note or enter a prompt before running.";
  }

  if (model.capabilities.promptMode === "unsupported" && input.nodePayload.prompt.trim()) {
    return `${model.displayName} does not support prompt input.`;
  }

  if (executionMode === "generate" && input.nodePayload.inputImageAssetIds.length > 0) {
    return "Disconnect image inputs before running prompt-only generation.";
  }

  if (executionMode === "edit" && input.nodePayload.inputImageAssetIds.length === 0) {
    return "Connect at least one supported image input before running.";
  }

  if (isRunnableOpenAiImageModel(input.providerId, input.modelId)) {
    const resolved = resolveOpenAiImageSettings(input.nodePayload.settings, executionMode, input.modelId);
    if (resolved.outputCount !== input.nodePayload.outputCount) {
      return "Output count is outside the supported range.";
    }
  }

  if (isRunnableTopazGigapixelModel(input.providerId, input.modelId)) {
    if (input.nodePayload.executionMode !== "edit") {
      return `${model.displayName} only supports edit mode.`;
    }

    if (input.nodePayload.inputImageAssetIds.length !== 1) {
      return `${model.displayName} requires exactly one connected image input.`;
    }

    if (input.nodePayload.outputCount !== 1) {
      return `${model.displayName} produces exactly one output.`;
    }

    resolveTopazGigapixelSettings(input.nodePayload.settings, input.modelId);
  }

  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;

    const jobs = await prisma.job.findMany({
      where: { projectId },
      include: {
        assets: {
          select: { id: true, type: true, mimeType: true, outputIndex: true, createdAt: true },
        },
        previewFrames: {
          select: {
            id: true,
            outputIndex: true,
            previewIndex: true,
            mimeType: true,
            width: true,
            height: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { previewIndex: "desc" }],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const serializedJobs = jobs.map(({ previewFrames, ...job }) => {
      const latestPreviewFrames = previewFrames.reduce<typeof previewFrames>((acc, previewFrame) => {
        if (acc.some((existing) => existing.outputIndex === previewFrame.outputIndex)) {
          return acc;
        }
        acc.push(previewFrame);
        return acc;
      }, []);

      return {
        ...job,
        latestPreviewFrames,
      };
    });

    return NextResponse.json({ jobs: serializedJobs });
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const parsed = createJobSchema.safeParse(await request.json());

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "Invalid payload");
    }

    await syncProviderModels();

    const submissionError = getSubmissionError(parsed.data);
    if (submissionError) {
      return badRequest(submissionError);
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        state: "queued",
        providerId: parsed.data.providerId,
        modelId: parsed.data.modelId,
        nodeRunPayload: parsed.data.nodePayload as Prisma.InputJsonValue,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    await dispatchJob(job.id);

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return internalError(error);
  }
}
