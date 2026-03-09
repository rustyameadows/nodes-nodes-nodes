import { desc, eq, sql } from "drizzle-orm";
import type { Project } from "@/components/workspace/types";
import { defaultCanvasDocument } from "@/components/workspace/types";
import { getDb } from "@/lib/db/client";
import { assets, canvases, jobs, projects, projectWorkspaceStates } from "@/lib/db/schema";
import { newId, nowIso } from "@/lib/services/common";
import { removeJobPreviewStorage, removeProjectStorage } from "@/lib/storage/local-storage";

function mapProject(
  row: typeof projects.$inferSelect,
  workspaceState: typeof projectWorkspaceStates.$inferSelect | null,
  counts: { jobs: number; assets: number }
): Project {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastOpenedAt: row.lastOpenedAt,
    workspaceState: workspaceState
      ? {
          isOpen: workspaceState.isOpen,
          assetViewerLayout: workspaceState.assetViewerLayout,
          filterState: workspaceState.filterState || null,
        }
      : null,
    _count: counts,
  };
}

async function getProjectCounts() {
  const db = getDb();
  const jobCounts = new Map(
    db
      .select({
        projectId: jobs.projectId,
        count: sql<number>`count(*)`,
      })
      .from(jobs)
      .groupBy(jobs.projectId)
      .all()
      .map((row) => [row.projectId, Number(row.count)])
  );
  const assetCounts = new Map(
    db
      .select({
        projectId: assets.projectId,
        count: sql<number>`count(*)`,
      })
      .from(assets)
      .groupBy(assets.projectId)
      .all()
      .map((row) => [row.projectId, Number(row.count)])
  );

  return {
    jobCounts,
    assetCounts,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = getDb();
  const projectRows = db.select().from(projects).orderBy(desc(projects.lastOpenedAt), desc(projects.createdAt)).all();
  const workspaceRows = new Map(
    db
      .select()
      .from(projectWorkspaceStates)
      .all()
      .map((row) => [row.projectId, row])
  );
  const counts = await getProjectCounts();

  return projectRows.map((project) =>
    mapProject(project, workspaceRows.get(project.id) || null, {
      jobs: counts.jobCounts.get(project.id) || 0,
      assets: counts.assetCounts.get(project.id) || 0,
    })
  );
}

export async function createProject(name: string): Promise<Project> {
  const db = getDb();
  const id = newId();
  const timestamp = nowIso();
  const openWorkspace = db
    .select()
    .from(projectWorkspaceStates)
    .where(eq(projectWorkspaceStates.isOpen, true))
    .get();
  const shouldOpen = !openWorkspace;

  db.transaction(() => {
    db.insert(projects)
      .values({
        id,
        name,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: shouldOpen ? timestamp : null,
      })
      .run();
    db.insert(projectWorkspaceStates)
      .values({
        projectId: id,
        isOpen: shouldOpen,
        viewportState: {},
        selectionState: {},
        filterState: {},
        assetViewerLayout: "grid",
        updatedAt: timestamp,
      })
      .run();
    db.insert(canvases)
      .values({
        projectId: id,
        canvasDocument: defaultCanvasDocument as unknown as Record<string, unknown>,
        version: 1,
        updatedAt: timestamp,
      })
      .run();
  });

  return (await listProjects()).find((project) => project.id === id)!;
}

export async function openProject(projectId: string) {
  const db = getDb();
  const timestamp = nowIso();

  db.transaction(() => {
    db.update(projectWorkspaceStates).set({ isOpen: false, updatedAt: timestamp }).run();
    db.insert(projectWorkspaceStates)
      .values({
        projectId,
        isOpen: true,
        viewportState: {},
        selectionState: {},
        filterState: {},
        assetViewerLayout: "grid",
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: projectWorkspaceStates.projectId,
        set: {
          isOpen: true,
          updatedAt: timestamp,
        },
      })
      .run();
    db.update(projects)
      .set({
        lastOpenedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(projects.id, projectId))
      .run();
  });
}

export async function updateProject(projectId: string, payload: { name?: string; status?: "active" | "archived" }) {
  const db = getDb();
  db.update(projects)
    .set({
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(projects.id, projectId))
    .run();

  return (await listProjects()).find((project) => project.id === projectId)!;
}

export async function deleteProject(projectId: string) {
  const db = getDb();
  const projectJobIds = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.projectId, projectId))
    .all()
    .map((job) => job.id);

  db.delete(projects).where(eq(projects.id, projectId)).run();
  await removeProjectStorage(projectId);
  await Promise.all(projectJobIds.map((jobId) => removeJobPreviewStorage(jobId)));
}

export async function getFallbackProject() {
  const projectList = await listProjects();
  return projectList.find((project) => project.status === "active") || projectList[0] || null;
}
