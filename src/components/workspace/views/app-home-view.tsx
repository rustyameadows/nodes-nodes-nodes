"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createProject,
  getProjects,
  openProject,
} from "@/components/workspace/client-api";
import type { Project } from "@/components/workspace/types";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppSettingsRoute,
  buildNodeLibraryRoute,
  buildWorkspaceRoute,
} from "@/renderer/workspace-route";
import styles from "./app-home-view.module.css";

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function resolveCurrentProject(projects: Project[]) {
  return (
    projects.find((project) => project.workspaceState?.isOpen) ||
    projects.find((project) => project.status === "active") ||
    projects[0] ||
    null
  );
}

type ProjectCardProps = {
  project: Project;
  busy: boolean;
  onOpen: (projectId: string) => Promise<void>;
};

function ProjectCard({ project, busy, onOpen }: ProjectCardProps) {
  const isOpen = Boolean(project.workspaceState?.isOpen);

  return (
    <button
      type="button"
      className={styles.projectCard}
      disabled={busy}
      aria-label={`Open project ${project.name}`}
      onClick={() => {
        void onOpen(project.id);
      }}
    >
      <div className={styles.cardHeader}>
        <div>
          <h3>{project.name}</h3>
          <p>{project.status === "archived" ? "Archived project" : "Local workspace"}</p>
        </div>

        <div className={styles.badgeRow}>
          {isOpen ? <span className={styles.badgeOpen}>Current</span> : null}
          <span className={project.status === "archived" ? styles.badgeArchived : styles.badgeActive}>
            {project.status === "archived" ? "Archived" : "Active"}
          </span>
        </div>
      </div>

      <div className={styles.cardMetaGrid}>
        <div className={styles.metaCard}>
          <span>Last Opened</span>
          <strong>{formatDate(project.lastOpenedAt)}</strong>
        </div>
        <div className={styles.metaCard}>
          <span>Assets</span>
          <strong>{project._count.assets}</strong>
        </div>
        <div className={styles.metaCard}>
          <span>Jobs</span>
          <strong>{project._count.jobs}</strong>
        </div>
      </div>
    </button>
  );
}

export function AppHomeView() {
  const router = useRouter();
  const [name, setName] = useState("New Project");
  const [busy, setBusy] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  const currentProject = useMemo(() => resolveCurrentProject(projects), [projects]);
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active"),
    [projects]
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived"),
    [projects]
  );

  const handleCreateProject = async () => {
    setBusy(true);
    setError(null);

    try {
      const project = await createProject(name.trim());
      await openProject(project.id);
      router.replace(buildWorkspaceRoute(project.id, "canvas"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create project");
      setBusy(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setBusyProjectId(projectId);
    setError(null);

    try {
      await openProject(projectId);
      router.push(buildWorkspaceRoute(projectId, "canvas"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not open project");
      setBusyProjectId(null);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.heroPanel}>
        <div className={styles.heroCopy}>
          <div className={styles.kicker}>Nodes Nodes Nodes</div>
          <h1>App Home</h1>
          <p>
            Create a project, reopen an existing workspace, or jump into app-wide settings.
          </p>
        </div>

        <div className={styles.heroMeta}>
          <div className={styles.heroMetaCard}>
            <span>Current Project</span>
            <strong>{currentProject ? currentProject.name : "No project open"}</strong>
          </div>
          <div className={styles.heroMetaCard}>
            <span>Total Projects</span>
            <strong>{isLoading ? "…" : projects.length}</strong>
          </div>
        </div>
      </section>

      <section className={styles.createPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Create Project</h2>
            <p>Start a new local workspace and land on canvas immediately.</p>
          </div>
        </div>

        <label className={styles.field}>
          Project Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            disabled={busy || Boolean(busyProjectId)}
          />
        </label>

        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={busy || Boolean(busyProjectId) || !name.trim()}
            onClick={() => {
              void handleCreateProject();
            }}
          >
            {busy ? "Creating..." : "Create Project"}
          </button>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || Boolean(busyProjectId)}
            onClick={() => {
              router.push(buildNodeLibraryRoute());
            }}
          >
            Node Library
          </button>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || Boolean(busyProjectId)}
            onClick={() => {
              router.push(buildAppSettingsRoute());
            }}
          >
            App Settings
          </button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
      </section>

      <section className={styles.projectsPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Active Projects</h2>
            <p>Open any active workspace and continue on its canvas.</p>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.loading}>Loading projects...</div>
        ) : activeProjects.length === 0 ? (
          <div className={styles.emptyState}>No active projects yet.</div>
        ) : (
          <div className={styles.projectGrid}>
            {activeProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy || busyProjectId !== null}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        )}
      </section>

      {archivedProjects.length > 0 ? (
        <section className={styles.projectsPanel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Archived Projects</h2>
              <p>Archived work stays separate but can still be reopened from home.</p>
            </div>
          </div>

          <div className={styles.projectGrid}>
            {archivedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy || busyProjectId !== null}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
