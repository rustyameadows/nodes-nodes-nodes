import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/server/http";
import { readAssetContent } from "@/lib/storage/local-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; jobId: string; previewFrameId: string }> }
) {
  try {
    const { projectId, jobId, previewFrameId } = await context.params;

    const previewFrame = await prisma.jobPreviewFrame.findFirst({
      where: {
        id: previewFrameId,
        jobId,
        job: {
          projectId,
        },
      },
    });

    if (!previewFrame) {
      return badRequest("Preview frame not found", 404);
    }

    const file = await readAssetContent(previewFrame.storageRef);

    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": previewFrame.mimeType,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return internalError(error);
  }
}
