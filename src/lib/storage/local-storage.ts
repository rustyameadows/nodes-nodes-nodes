import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getAssetsRoot, getJobPreviewRoot, getProjectAssetsRoot, getPreviewsRoot } from "@/lib/runtime/app-paths";

export type StoredAsset = {
  storageRef: string;
  absolutePath: string;
  checksum: string;
};

function sanitizeExtension(extension: string) {
  const cleaned = extension.replace(/^\.+/, "").toLowerCase();
  return cleaned || "bin";
}

async function saveBufferToRoot(rootDir: string, storagePrefix: string, extension: string, buffer: Buffer): Promise<StoredAsset> {
  await mkdir(rootDir, { recursive: true });
  const safeExtension = sanitizeExtension(extension);
  const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16);
  const fileName = `${Date.now()}-${hash}.${safeExtension}`;
  const absolutePath = path.join(rootDir, fileName);

  await writeFile(absolutePath, buffer);

  return {
    storageRef: path.join(storagePrefix, fileName),
    absolutePath,
    checksum: hash,
  };
}

async function saveBuffer(projectId: string, extension: string, buffer: Buffer): Promise<StoredAsset> {
  return saveBufferToRoot(getProjectAssetsRoot(projectId), projectId, extension, buffer);
}

export async function saveContentAsAsset(
  projectId: string,
  extension: string,
  content: string,
  encoding: BufferEncoding = "utf8"
): Promise<StoredAsset> {
  const buffer = Buffer.from(content, encoding);
  return saveBuffer(projectId, extension, buffer);
}

export async function saveBufferAsAsset(
  projectId: string,
  extension: string,
  content: Buffer
): Promise<StoredAsset> {
  return saveBuffer(projectId, extension, content);
}

export async function saveBufferAsPreview(jobId: string, extension: string, content: Buffer): Promise<StoredAsset> {
  return saveBufferToRoot(getJobPreviewRoot(jobId), path.join("previews", jobId), extension, content);
}

export function getAssetAbsolutePath(storageRef: string): string {
  if (storageRef.startsWith(`previews${path.sep}`) || storageRef.startsWith("previews/")) {
    return path.join(getPreviewsRoot(), storageRef.replace(/^previews[\\/]/, ""));
  }
  return path.join(getAssetsRoot(), storageRef);
}

export async function readAssetContent(storageRef: string): Promise<Buffer> {
  return readFile(getAssetAbsolutePath(storageRef));
}

export async function overwriteAssetContent(storageRef: string, content: Buffer) {
  await writeFile(getAssetAbsolutePath(storageRef), content);
}

export async function removeProjectStorage(projectId: string) {
  await rm(getProjectAssetsRoot(projectId), { recursive: true, force: true });
}

export async function removeJobPreviewStorage(jobId: string) {
  await rm(path.join(getPreviewsRoot(), jobId), { recursive: true, force: true });
}
