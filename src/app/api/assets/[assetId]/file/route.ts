import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { overwriteAssetContent, readAssetContent } from "@/lib/storage/local-storage";
import { badRequest, internalError } from "@/lib/server/http";

export const runtime = "nodejs";

function readDownloadUrlFromEnvelope(buffer: Buffer) {
  const text = buffer.toString("utf8").trim();
  if (!text.startsWith("{")) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const directUrl =
      typeof payload.download_url === "string"
        ? payload.download_url
        : typeof payload.downloadUrl === "string"
          ? payload.downloadUrl
          : typeof payload.head_url === "string"
            ? payload.head_url
            : typeof payload.headUrl === "string"
              ? payload.headUrl
              : null;

    return directUrl && directUrl.trim() ? directUrl.trim() : null;
  } catch {
    return null;
  }
}

async function repairImageEnvelopeIfNeeded(storageRef: string, mimeType: string, file: Buffer) {
  if (!mimeType.startsWith("image/")) {
    return file;
  }

  const downloadUrl = readDownloadUrlFromEnvelope(file);
  if (!downloadUrl) {
    return file;
  }

  const response = await fetch(downloadUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to hydrate stored image asset from Topaz download URL (${response.status}).`);
  }

  const repaired = Buffer.from(await response.arrayBuffer());
  await overwriteAssetContent(storageRef, repaired);
  return repaired;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });

    if (!asset) {
      return badRequest("Asset not found", 404);
    }

    const file = await readAssetContent(asset.storageRef);
    const hydratedFile = await repairImageEnvelopeIfNeeded(asset.storageRef, asset.mimeType, file);

    return new NextResponse(new Uint8Array(hydratedFile), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internalError(error);
  }
}
