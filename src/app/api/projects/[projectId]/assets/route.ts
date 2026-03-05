import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalError } from "@/lib/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);

    const type = searchParams.get("type") || "all";
    const flaggedOnly = searchParams.get("flaggedOnly") === "true";
    const ratingAtLeast = Number(searchParams.get("ratingAtLeast") || 0);
    const providerId = searchParams.get("providerId") || "all";
    const tag = searchParams.get("tag") || "";
    const sort = searchParams.get("sort") || "newest";
    const origin = searchParams.get("origin") || "all";
    const query = searchParams.get("q") || "";

    const providerFilter =
      providerId !== "all"
        ? {
            OR: [
              {
                job: {
                  is: {
                    providerId,
                  },
                },
              },
              {
                jobId: null,
              },
            ],
          }
        : {};

    const assets = await prisma.asset.findMany({
      where: {
        projectId,
        ...(origin === "generated"
          ? {
              jobId: {
                not: null,
              },
            }
          : origin === "uploaded"
            ? {
                jobId: null,
              }
            : {}),
        ...(type !== "all" ? { type: type as "image" | "video" | "text" } : {}),
        ...(flaggedOnly
          ? {
              feedback: {
                is: {
                  flagged: true,
                },
              },
            }
          : {}),
        ...(ratingAtLeast > 0
          ? {
              feedback: {
                is: {
                  rating: {
                    gte: ratingAtLeast,
                  },
                },
              },
            }
          : {}),
        ...providerFilter,
        ...(query
          ? {
              OR: [
                {
                  id: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
                {
                  storageRef: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
                {
                  job: {
                    is: {
                      providerId: {
                        contains: query,
                        mode: "insensitive",
                      },
                    },
                  },
                },
                {
                  job: {
                    is: {
                      modelId: {
                        contains: query,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              ],
            }
          : {}),
        ...(tag
          ? {
              tags: {
                some: {
                  tag: {
                    name: {
                      equals: tag,
                      mode: "insensitive",
                    },
                  },
                },
              },
            }
          : {}),
      },
      include: {
        feedback: true,
        tags: {
          include: { tag: true },
        },
        job: {
          select: {
            providerId: true,
            modelId: true,
            state: true,
          },
        },
      },
      orderBy:
        sort === "oldest"
          ? { createdAt: "asc" }
          : sort === "rating"
            ? { feedback: { rating: "desc" } }
            : { createdAt: "desc" },
      take: 300,
    });

    const serialized = assets.map((asset) => ({
      ...asset,
      origin: asset.jobId ? "generated" : "uploaded",
      tagNames: asset.tags.map((link) => link.tag.name),
      rating: asset.feedback?.rating ?? null,
      flagged: asset.feedback?.flagged ?? false,
    }));

    return NextResponse.json({ assets: serialized });
  } catch (error) {
    return internalError(error);
  }
}
