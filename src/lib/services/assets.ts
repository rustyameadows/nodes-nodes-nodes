import path from "node:path";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Asset, AssetFilterState } from "@/components/workspace/types";
import { getImageDimensions } from "@/lib/image-dimensions";
import { getDb } from "@/lib/db/client";
import { assetFeedback, assetTagLinks, assetTags, assets, jobAttempts, jobs } from "@/lib/db/schema";
import { nowIso, newId } from "@/lib/services/common";
import { overwriteAssetContent, readAssetContent, saveBufferAsAsset } from "@/lib/storage/local-storage";

const updateAssetSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  flagged: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).optional(),
});

export type ImportedAssetInput = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

function inferAssetType(mimeType: string): Asset["type"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "text";
}

function inferExtension(fileName: string, mimeType: string, assetType: Asset["type"]) {
  const ext = path.extname(fileName).replace(/^\.+/, "").toLowerCase();
  if (ext) return ext;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "application/json") return "json";
  if (mimeType.startsWith("text/")) return "txt";
  if (assetType === "image") return "img";
  if (assetType === "video") return "video";
  return "bin";
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".json") return "application/json";
  if (extension === ".txt" || extension === ".md") return "text/plain";
  return "application/octet-stream";
}

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

  return {
    width: typeof topazRequest.output_width === "number" ? topazRequest.output_width : null,
    height: typeof topazRequest.output_height === "number" ? topazRequest.output_height : null,
  };
}

async function resolveImageDimensions(options: {
  type: Asset["type"];
  mimeType: string;
  storageRef: string;
  width: number | null;
  height: number | null;
}) {
  if (options.type !== "image") {
    return { width: options.width, height: options.height };
  }

  if (typeof options.width === "number" && typeof options.height === "number") {
    return { width: options.width, height: options.height };
  }

  try {
    const buffer = await readAssetContent(options.storageRef);
    const inferred = getImageDimensions(buffer, options.mimeType);
    return {
      width: options.width ?? inferred?.width ?? null,
      height: options.height ?? inferred?.height ?? null,
    };
  } catch {
    return { width: options.width, height: options.height };
  }
}

async function getTagNamesForAssets(assetIds: string[]) {
  const db = getDb();
  const links = assetIds.length
    ? db.select().from(assetTagLinks).where(inArray(assetTagLinks.assetId, assetIds)).all()
    : [];
  const tagIds = [...new Set(links.map((link) => link.tagId))];
  const tagsById = new Map(
    (tagIds.length ? db.select().from(assetTags).where(inArray(assetTags.id, tagIds)).all() : []).map((tag) => [
      tag.id,
      tag.name,
    ])
  );

  return links.reduce<Map<string, string[]>>((acc, link) => {
    const next = acc.get(link.assetId) || [];
    const tagName = tagsById.get(link.tagId);
    if (tagName) {
      next.push(tagName);
      acc.set(link.assetId, next);
    }
    return acc;
  }, new Map());
}

function assetMatchesFilters(
  asset: Asset,
  filters: AssetFilterState,
  options?: { origin?: "all" | "uploaded" | "generated"; query?: string }
) {
  if (options?.origin === "generated" && asset.origin !== "generated") return false;
  if (options?.origin === "uploaded" && asset.origin !== "uploaded") return false;
  if (filters.type !== "all" && asset.type !== filters.type) return false;
  if (filters.flaggedOnly && !asset.flagged) return false;
  if (filters.ratingAtLeast > 0 && (asset.rating || 0) < filters.ratingAtLeast) return false;
  if (filters.providerId !== "all" && asset.job?.providerId !== filters.providerId && asset.jobId) return false;
  if (filters.tag && !asset.tagNames.some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) return false;
  if (options?.query) {
    const query = options.query.toLowerCase();
    const haystack = [asset.id, asset.storageRef, asset.job?.providerId || "", asset.job?.modelId || "", ...asset.tagNames]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function sortAssets(items: Asset[], sort: AssetFilterState["sort"]) {
  return [...items].sort((left, right) => {
    if (sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
    if (sort === "rating") return (right.rating || 0) - (left.rating || 0) || right.createdAt.localeCompare(left.createdAt);
    return right.createdAt.localeCompare(left.createdAt);
  });
}

async function serializeAssets(rows: typeof assets.$inferSelect[]): Promise<Asset[]> {
  const db = getDb();
  const assetIds = rows.map((asset) => asset.id);
  const jobIds = [...new Set(rows.map((asset) => asset.jobId).filter((jobId): jobId is string => Boolean(jobId)))];
  const feedbackByAssetId = new Map(
    (assetIds.length ? db.select().from(assetFeedback).where(inArray(assetFeedback.assetId, assetIds)).all() : []).map((row) => [
      row.assetId,
      row,
    ])
  );
  const jobsById = new Map(
    (jobIds.length ? db.select().from(jobs).where(inArray(jobs.id, jobIds)).all() : []).map((row) => [row.id, row])
  );
  const tagNamesByAssetId = await getTagNamesForAssets(assetIds);
  const latestAttemptByJobId = new Map(
    (jobIds.length ? db.select().from(jobAttempts).where(inArray(jobAttempts.jobId, jobIds)).all() : [])
      .sort((left, right) => right.attemptNumber - left.attemptNumber || right.createdAt.localeCompare(left.createdAt))
      .reduce<typeof jobAttempts.$inferSelect[]>((acc, attempt) => {
        if (!acc.some((item) => item.jobId === attempt.jobId)) {
          acc.push(attempt);
        }
        return acc;
      }, [])
      .map((attempt) => [attempt.jobId, attempt])
  );

  return Promise.all(
    rows.map(async (row) => {
      const feedback = feedbackByAssetId.get(row.id);
      const job = row.jobId ? jobsById.get(row.jobId) || null : null;
      const latestAttempt = row.jobId ? latestAttemptByJobId.get(row.jobId) || null : null;
      const storedDimensions = await resolveImageDimensions({
        type: row.type,
        mimeType: row.mimeType,
        storageRef: row.storageRef,
        width: row.width ?? null,
        height: row.height ?? null,
      });
      const topazFallback =
        job?.providerId === "topaz" && (storedDimensions.width == null || storedDimensions.height == null)
          ? readTopazRequestDimensions(latestAttempt?.providerRequest || null)
          : { width: null, height: null };

      return {
        id: row.id,
        projectId: row.projectId,
        jobId: row.jobId,
        origin: row.jobId ? "generated" : "uploaded",
        type: row.type,
        storageRef: row.storageRef,
        mimeType: row.mimeType,
        outputIndex: row.outputIndex,
        checksum: row.checksum || undefined,
        width: storedDimensions.width ?? topazFallback.width,
        height: storedDimensions.height ?? topazFallback.height,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        tagNames: tagNamesByAssetId.get(row.id) || [],
        rating: feedback?.rating ?? null,
        flagged: feedback?.flagged ?? false,
        job: job
          ? {
              providerId: job.providerId,
              modelId: job.modelId,
              state: job.state,
            }
          : null,
      } satisfies Asset;
    })
  );
}

export async function createImportedAsset(projectId: string, input: ImportedAssetInput, jobId?: string | null, outputIndex?: number | null) {
  const db = getDb();
  const assetType = inferAssetType(input.mimeType);
  const extension = inferExtension(input.name, input.mimeType, assetType);
  const stored = await saveBufferAsAsset(projectId, extension, input.buffer);
  const imageDimensions = assetType === "image" ? getImageDimensions(input.buffer, input.mimeType) : null;
  const timestamp = nowIso();
  const assetId = newId();

  db.insert(assets)
    .values({
      id: assetId,
      projectId,
      jobId: jobId || null,
      type: assetType,
      storageRef: stored.storageRef,
      mimeType: input.mimeType || "application/octet-stream",
      checksum: stored.checksum,
      width: imageDimensions?.width ?? null,
      height: imageDimensions?.height ?? null,
      outputIndex: outputIndex ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(assetFeedback)
    .values({
      assetId,
      rating: null,
      flagged: false,
      updatedAt: timestamp,
    })
    .run();

  const [asset] = await serializeAssets([db.select().from(assets).where(eq(assets.id, assetId)).get()!]);
  return asset;
}

export async function importAssets(projectId: string, inputs: ImportedAssetInput[]) {
  const imported: Asset[] = [];
  for (const input of inputs) {
    imported.push(await createImportedAsset(projectId, input));
  }
  return imported;
}

export async function importAssetsFromPaths(projectId: string, filePaths: string[]) {
  const imported: ImportedAssetInput[] = [];
  for (const filePath of filePaths) {
    imported.push({
      name: path.basename(filePath),
      mimeType: inferMimeType(filePath),
      buffer: await readFile(filePath),
    });
  }

  return importAssets(projectId, imported);
}

export async function listAssets(
  projectId: string,
  filters: AssetFilterState,
  options?: {
    origin?: "all" | "uploaded" | "generated";
    query?: string;
  }
) {
  const db = getDb();
  const serialized = await serializeAssets(db.select().from(assets).where(eq(assets.projectId, projectId)).all());
  return sortAssets(
    serialized.filter((asset) => assetMatchesFilters(asset, filters, options)).slice(0, 300),
    filters.sort
  );
}

export async function getAsset(assetId: string) {
  const db = getDb();
  const row = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!row) {
    throw new Error("Asset not found");
  }

  return (await serializeAssets([row]))[0];
}

export async function updateAsset(assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) {
  const parsed = updateAssetSchema.parse(payload);
  const db = getDb();
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    throw new Error("Asset not found");
  }

  const timestamp = nowIso();

  db.insert(assetFeedback)
    .values({
      assetId,
      rating: parsed.rating ?? null,
      flagged: parsed.flagged ?? false,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: assetFeedback.assetId,
      set: {
        ...(parsed.rating !== undefined ? { rating: parsed.rating } : {}),
        ...(parsed.flagged !== undefined ? { flagged: parsed.flagged } : {}),
        updatedAt: timestamp,
      },
    })
    .run();

  if (parsed.tags) {
    const uniqueTags = [...new Set(parsed.tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean))];
    db.transaction(() => {
      db.delete(assetTagLinks).where(eq(assetTagLinks.assetId, assetId)).run();

      for (const tagName of uniqueTags) {
        let tag = db
          .select()
          .from(assetTags)
          .where(eq(assetTags.projectId, asset.projectId))
          .all()
          .find((item) => item.name === tagName);

        if (!tag) {
          const nextId = newId();
          db.insert(assetTags)
            .values({
              id: nextId,
              projectId: asset.projectId,
              name: tagName,
              createdAt: timestamp,
            })
            .run();
          tag = db.select().from(assetTags).where(eq(assetTags.id, nextId)).get()!;
        }

        db.insert(assetTagLinks)
          .values({
            assetId,
            tagId: tag.id,
            createdAt: timestamp,
          })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  return getAsset(assetId);
}

async function readDownloadUrlFromEnvelope(storageRef: string, mimeType: string) {
  if (!mimeType.startsWith("image/")) {
    return null;
  }

  const buffer = await readAssetContent(storageRef);
  const text = buffer.toString("utf8").trim();
  if (!text.startsWith("{")) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    return (
      (typeof payload.download_url === "string" ? payload.download_url : null) ||
      (typeof payload.downloadUrl === "string" ? payload.downloadUrl : null) ||
      (typeof payload.head_url === "string" ? payload.head_url : null) ||
      (typeof payload.headUrl === "string" ? payload.headUrl : null) ||
      null
    );
  } catch {
    return null;
  }
}

export async function readAssetFile(storageRef: string, mimeType: string) {
  const buffer = await readAssetContent(storageRef);
  const downloadUrl = await readDownloadUrlFromEnvelope(storageRef, mimeType);
  if (!downloadUrl) {
    return buffer;
  }

  const response = await fetch(downloadUrl, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to hydrate stored image asset from Topaz download URL (${response.status}).`);
  }

  const repaired = Buffer.from(await response.arrayBuffer());
  await overwriteAssetContent(storageRef, repaired);
  return repaired;
}
