import { getImageDimensions } from "@/lib/image-dimensions";
import { readAssetContent } from "@/lib/storage/local-storage";

export async function resolveStoredImageDimensions(options: {
  type: "image" | "video" | "text";
  mimeType: string;
  storageRef: string;
  width: number | null;
  height: number | null;
}) {
  if (options.type !== "image") {
    return {
      width: options.width,
      height: options.height,
    };
  }

  if (typeof options.width === "number" && typeof options.height === "number") {
    return {
      width: options.width,
      height: options.height,
    };
  }

  try {
    const buffer = await readAssetContent(options.storageRef);
    const inferred = getImageDimensions(buffer, options.mimeType);
    return {
      width: options.width ?? inferred?.width ?? null,
      height: options.height ?? inferred?.height ?? null,
    };
  } catch {
    return {
      width: options.width,
      height: options.height,
    };
  }
}
