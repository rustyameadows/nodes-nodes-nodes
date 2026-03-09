import { eq, sql } from "drizzle-orm";
import type { CanvasDocument } from "@/components/workspace/types";
import { getDb } from "@/lib/db/client";
import { canvases, projectWorkspaceStates } from "@/lib/db/schema";
import { nowIso } from "@/lib/services/common";

export async function getWorkspaceSnapshot(projectId: string) {
  const db = getDb();
  const canvas = db.select().from(canvases).where(eq(canvases.projectId, projectId)).get();
  const workspace = db.select().from(projectWorkspaceStates).where(eq(projectWorkspaceStates.projectId, projectId)).get();

  return {
    canvas: canvas
      ? {
          canvasDocument: canvas.canvasDocument || null,
        }
      : null,
    workspace: workspace
      ? {
          assetViewerLayout: workspace.assetViewerLayout,
          filterState: workspace.filterState || null,
        }
      : null,
  };
}

export async function saveWorkspaceSnapshot(
  projectId: string,
  payload: {
    canvasDocument: CanvasDocument;
    assetViewerLayout?: "grid" | "compare_2" | "compare_4";
    filterState?: Record<string, unknown>;
  }
) {
  const db = getDb();
  const timestamp = nowIso();

  db.transaction(() => {
    db.insert(canvases)
      .values({
        projectId,
        canvasDocument: payload.canvasDocument as unknown as Record<string, unknown>,
        version: 1,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: canvases.projectId,
        set: {
          canvasDocument: payload.canvasDocument as unknown as Record<string, unknown>,
          version: sql`${canvases.version} + 1`,
          updatedAt: timestamp,
        },
      })
      .run();

    if (payload.assetViewerLayout || payload.filterState) {
      db.insert(projectWorkspaceStates)
        .values({
          projectId,
          isOpen: false,
          viewportState: {},
          selectionState: {},
          filterState: payload.filterState || {},
          assetViewerLayout: payload.assetViewerLayout || "grid",
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: projectWorkspaceStates.projectId,
          set: {
            ...(payload.assetViewerLayout ? { assetViewerLayout: payload.assetViewerLayout } : {}),
            ...(payload.filterState ? { filterState: payload.filterState } : {}),
            updatedAt: timestamp,
          },
        })
        .run();
    }
  });
}
