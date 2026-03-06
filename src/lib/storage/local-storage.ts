import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const assetRoot = process.env.ASSET_STORAGE_ROOT || path.join(process.cwd(), ".local-assets");

export type StoredAsset = {
  storageRef: string;
  absolutePath: string;
  checksum: string;
};

async function ensureRoot() {
  await mkdir(assetRoot, { recursive: true });
}

function sanitizeExtension(extension: string) {
  const cleaned = extension.replace(/^\.+/, "").toLowerCase();
  return cleaned || "bin";
}

async function saveBuffer(projectId: string, extension: string, buffer: Buffer): Promise<StoredAsset> {
  await ensureRoot();

  const bucketDir = path.join(assetRoot, projectId);
  await mkdir(bucketDir, { recursive: true });

  const safeExtension = sanitizeExtension(extension);
  const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16);
  const fileName = `${Date.now()}-${hash}.${safeExtension}`;
  const absolutePath = path.join(bucketDir, fileName);

  await writeFile(absolutePath, buffer);

  return {
    storageRef: path.join(projectId, fileName),
    absolutePath,
    checksum: hash,
  };
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

export function getAssetAbsolutePath(storageRef: string): string {
  return path.join(assetRoot, storageRef);
}

export async function readAssetContent(storageRef: string): Promise<Buffer> {
  return readFile(getAssetAbsolutePath(storageRef));
}

export async function overwriteAssetContent(storageRef: string, content: Buffer) {
  await ensureRoot();
  await writeFile(getAssetAbsolutePath(storageRef), content);
}
