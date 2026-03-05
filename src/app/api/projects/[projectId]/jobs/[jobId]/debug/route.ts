import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; jobId: string }> }
) {
  try {
    const { projectId, jobId } = await context.params;

    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        projectId,
      },
      include: {
        assets: {
          select: {
            id: true,
            type: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!job) {
      return badRequest("Job not found", 404);
    }

    const attempts = await prisma.jobAttempt.findMany({
      where: { jobId: job.id },
      orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      job,
      attempts,
    });
  } catch (error) {
    return internalError(error);
  }
}
