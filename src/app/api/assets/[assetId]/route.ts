import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveStoredImageDimensions } from "@/lib/server/asset-dimensions";
import { badRequest, internalError } from "@/lib/server/http";

const updateSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  flagged: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
});

function readTopazRequestDimensions(value: unknown) {
  if (!value || typeof value !== "object") {
    return { width: null, height: null };
  }

  const record = value as Record<string, unknown>;
  const topazRequest =
    record.topazApiRequest && typeof record.topazApiRequest === "object"
      ? (record.topazApiRequest as Record<string, unknown>)
      : record.request && typeof record.request === "object"
        ? (record.request as Record<string, unknown>)
        : record;

  const width =
    typeof topazRequest.output_width === "number" && Number.isFinite(topazRequest.output_width)
      ? topazRequest.output_width
      : null;
  const height =
    typeof topazRequest.output_height === "number" && Number.isFinite(topazRequest.output_height)
      ? topazRequest.output_height
      : null;

  return { width, height };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await context.params;
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        feedback: true,
        tags: {
          include: { tag: true },
        },
        job: {
          include: {
            attemptsLog: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                providerRequest: true,
              },
            },
          },
        },
      },
    });

    if (!asset) {
      return badRequest("Asset not found", 404);
    }

    const latestAttemptRequest = asset.job?.attemptsLog?.[0]?.providerRequest;
    const storedDimensions = await resolveStoredImageDimensions({
      type: asset.type,
      mimeType: asset.mimeType,
      storageRef: asset.storageRef,
      width: asset.width,
      height: asset.height,
    });
    const topazFallbackDimensions =
      asset.job?.providerId === "topaz" &&
      (storedDimensions.width == null || storedDimensions.height == null)
        ? readTopazRequestDimensions(latestAttemptRequest)
        : { width: null, height: null };

    return NextResponse.json({
      asset: {
        ...asset,
        width: storedDimensions.width ?? topazFallbackDimensions.width,
        height: storedDimensions.height ?? topazFallbackDimensions.height,
        tagNames: asset.tags.map((link) => link.tag.name),
        rating: asset.feedback?.rating ?? null,
        flagged: asset.feedback?.flagged ?? false,
      },
    });
  } catch (error) {
    return internalError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await context.params;
    const parsed = updateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "Invalid payload");
    }

    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      return badRequest("Asset not found", 404);
    }

    const payload = parsed.data;

    await prisma.assetFeedback.upsert({
      where: { assetId },
      create: {
        assetId,
        rating: payload.rating ?? null,
        flagged: payload.flagged ?? false,
      },
      update: {
        ...(payload.rating !== undefined ? { rating: payload.rating } : {}),
        ...(payload.flagged !== undefined ? { flagged: payload.flagged } : {}),
      },
    });

    if (payload.tags) {
      const uniqueTags = [...new Set(payload.tags.map((name) => name.toLowerCase().trim()).filter(Boolean))];

      await prisma.$transaction(async (tx) => {
        await tx.assetTagLink.deleteMany({ where: { assetId } });

        for (const tagName of uniqueTags) {
          const tag = await tx.assetTag.upsert({
            where: {
              projectId_name: {
                projectId: asset.projectId,
                name: tagName,
              },
            },
            update: {},
            create: {
              projectId: asset.projectId,
              name: tagName,
            },
          });

          await tx.assetTagLink.create({
            data: {
              assetId,
              tagId: tag.id,
            },
          });
        }
      });
    }

    const updated = await prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        feedback: true,
        tags: {
          include: { tag: true },
        },
      },
    });

    return NextResponse.json({
      asset: {
        ...updated,
        tagNames: updated?.tags.map((link) => link.tag.name) || [],
        rating: updated?.feedback?.rating ?? null,
        flagged: updated?.feedback?.flagged ?? false,
      },
    });
  } catch (error) {
    return internalError(error);
  }
}
