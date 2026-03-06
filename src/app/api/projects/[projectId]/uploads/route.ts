import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getImageDimensions } from "@/lib/image-dimensions";
import { saveBufferAsAsset } from "@/lib/storage/local-storage";
import { badRequest, internalError } from "@/lib/server/http";

const maxUploadSizeBytes = 120 * 1024 * 1024;

function inferAssetType(mimeType: string): "image" | "video" | "text" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "text";
}

function inferExtension(fileName: string, mimeType: string, assetType: "image" | "video" | "text") {
  const ext = path.extname(fileName).replace(/^\.+/, "").toLowerCase();
  if (ext) {
    return ext;
  }

  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/svg+xml") {
    return "svg";
  }
  if (mimeType === "video/mp4") {
    return "mp4";
  }
  if (mimeType === "video/webm") {
    return "webm";
  }
  if (mimeType === "application/json") {
    return "json";
  }
  if (mimeType.startsWith("text/")) {
    return "txt";
  }

  if (assetType === "image") {
    return "img";
  }
  if (assetType === "video") {
    return "video";
  }
  return "bin";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const formData = await request.formData();
    const fileInput = formData.get("file");

    if (!(fileInput instanceof File)) {
      return badRequest("Expected file upload in 'file' field.");
    }

    if (fileInput.size <= 0) {
      return badRequest("Uploaded file is empty.");
    }

    if (fileInput.size > maxUploadSizeBytes) {
      return badRequest("Uploaded file exceeds 120MB limit.");
    }

    const mimeType = fileInput.type || "application/octet-stream";
    const assetType = inferAssetType(mimeType);
    const extension = inferExtension(fileInput.name, mimeType, assetType);
    const fileBuffer = Buffer.from(await fileInput.arrayBuffer());
    const imageDimensions = assetType === "image" ? getImageDimensions(fileBuffer, mimeType) : null;
    const stored = await saveBufferAsAsset(projectId, extension, fileBuffer);

    const asset = await prisma.asset.create({
      data: {
        projectId,
        jobId: null,
        type: assetType,
        storageRef: stored.storageRef,
        mimeType,
        checksum: stored.checksum,
        width: imageDimensions?.width ?? null,
        height: imageDimensions?.height ?? null,
      },
    });

    await prisma.assetFeedback.create({
      data: {
        assetId: asset.id,
        rating: null,
        flagged: false,
      },
    });

    return NextResponse.json(
      {
        asset: {
          ...asset,
          job: null,
          tagNames: [],
          rating: null,
          flagged: false,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return internalError(error);
  }
}
