import type { Asset } from "@/components/workspace/types";
import { buildCanvasViewportCenterPosition, getImportedAssetLabelsFromPaths, insertImportedAssetsIntoCanvasDocument } from "@/lib/canvas-asset-nodes";
import { normalizeCanvasDocument } from "@/lib/canvas-document";
import { getFallbackProviderModel } from "@/lib/provider-model-helpers";
import type { ImportAssetsToProjectCanvasRequest } from "@/lib/ipc-contract";
import { importAssets, importAssetsFromPaths } from "@/lib/services/assets";
import { listProviders } from "@/lib/services/providers";
import { getWorkspaceSnapshot, saveWorkspaceSnapshot } from "@/lib/services/workspace";

export type ImportAssetsToProjectCanvasOptions = ImportAssetsToProjectCanvasRequest & {
  viewportWidth?: number;
  viewportHeight?: number;
  stagedDropFilePaths?: string[];
};

export async function importAssetsToProjectCanvas(
  projectId: string,
  options?: ImportAssetsToProjectCanvasOptions
): Promise<{
  importedAssets: Asset[];
  insertedNodeIds: string[];
}> {
  const filePaths = options?.useStagedDropFiles ? options?.stagedDropFilePaths || [] : [];
  const importedAssets =
    options?.items && options.items.length > 0
      ? await importAssets(
          projectId,
          options.items.map((item) => ({
            name: item.name,
            mimeType: item.mimeType,
            buffer: Buffer.from(item.content),
          }))
        )
      : filePaths.length > 0
        ? await importAssetsFromPaths(projectId, filePaths)
        : [];

  if (importedAssets.length === 0) {
    return {
      importedAssets: [],
      insertedNodeIds: [],
    };
  }

  const [workspaceSnapshot, providers] = await Promise.all([getWorkspaceSnapshot(projectId), listProviders()]);
  const canvasDocument = normalizeCanvasDocument(
    (workspaceSnapshot.canvas?.canvasDocument || null) as Record<string, unknown> | null
  );
  const defaultProvider = getFallbackProviderModel(providers);
  const nextPosition = buildCanvasViewportCenterPosition(canvasDocument, {
    viewportWidth: options?.viewportWidth,
    viewportHeight: options?.viewportHeight,
  });
  const { canvasDocument: nextCanvasDocument, insertedNodeIds } = insertImportedAssetsIntoCanvasDocument(
    canvasDocument,
    importedAssets,
    {
      defaultProvider,
      position: nextPosition,
      assetLabels: options?.items?.map((item) => item.name) || getImportedAssetLabelsFromPaths(filePaths),
    }
  );

  await saveWorkspaceSnapshot(projectId, {
    canvasDocument: nextCanvasDocument,
  });

  return {
    importedAssets,
    insertedNodeIds,
  };
}
