"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@/renderer/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  getProjects,
  openProject,
  removeProject,
  updateProject,
} from "@/components/workspace/client-api";
import type { Project } from "@/components/workspace/types";
import { queryKeys } from "@/renderer/query";
import styles from "./settings-view.module.css";

type Props = {
  projectId: string;
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

export function SettingsView({ projectId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  const project = useMemo(() => projects.find((item) => item.id === projectId) || null, [projects, projectId]);

  useEffect(() => {
    openProject(projectId).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    if (project) {
      setName(project.name);
    }
  }, [project]);

  return (
    <WorkspaceShell projectId={projectId} view="settings">
      <main className={styles.page}>
        <section className={styles.panel}>
          <h1>Project Settings</h1>

          {isLoading ? (
            <div className={styles.loading}>Loading project...</div>
          ) : !project ? (
            <div className={styles.error}>Project not found.</div>
          ) : (
            <>
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
              </label>

              <div className={styles.metaRow}>
                <span>Created</span>
                <strong>{formatDate(project.createdAt)}</strong>
              </div>

              <div className={styles.metaRow}>
                <span>Updated</span>
                <strong>{formatDate(project.updatedAt)}</strong>
              </div>

              <div className={styles.metaRow}>
                <span>Last Opened</span>
                <strong>{formatDate(project.lastOpenedAt)}</strong>
              </div>

              <div className={styles.actionRow}>
                <button
                  disabled={busy || !name.trim() || name.trim() === project.name}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);

                    try {
                      await updateProject(projectId, { name: name.trim() });
                    } catch (nextError) {
                      setError(nextError instanceof Error ? nextError.message : "Failed to rename project");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save Name
                </button>

                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);

                    try {
                      await updateProject(projectId, {
                        status: project.status === "active" ? "archived" : "active",
                      });
                    } catch (nextError) {
                      setError(nextError instanceof Error ? nextError.message : "Failed to update status");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {project.status === "active" ? "Archive Project" : "Unarchive Project"}
                </button>
              </div>

              <button
                className={styles.deleteButton}
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Delete project '${project.name}' and all data?`)) {
                    return;
                  }

                  setBusy(true);
                  setError(null);

                  try {
                    await removeProject(projectId);
                    const nextProjects = await getProjects();

                    const fallback = nextProjects.find((item) => item.status === "active") || nextProjects[0] || null;
                    if (!fallback) {
                      router.replace("/");
                      return;
                    }

                    await openProject(fallback.id);
                    router.replace(`/projects/${fallback.id}/canvas`);
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : "Failed to delete project");
                    setBusy(false);
                  }
                }}
              >
                Delete Project
              </button>

              {error && <div className={styles.error}>{error}</div>}
            </>
          )}
        </section>
      </main>
    </WorkspaceShell>
  );
}
