"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyState, Panel } from "@/components/ui";
import type { Project } from "@/components/workspace/types";
import {
  createProject,
  dismissMenuBarDropState,
  getMenuBarState,
  getProjects,
  importAssetsToProjectCanvas,
  openProject,
  quitApp,
  showApp,
  subscribeToMenuBarState,
} from "@/components/workspace/client-api";
import type { MenuBarState } from "@/lib/ipc-contract";
import { queryKeys } from "@/renderer/query";
import styles from "./menu-bar-view.module.css";

const defaultMenuBarState: MenuBarState = {
  mode: "default",
  stagedDropFiles: [],
};

export function MenuBarView() {
  const [menuBarState, setMenuBarState] = useState<MenuBarState>(defaultMenuBarState);
  const [dropHoverProjectId, setDropHoverProjectId] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  useEffect(() => {
    getMenuBarState()
      .then((state) => setMenuBarState(state))
      .catch((error) => {
        console.error("Failed to load menu bar state", error);
      });
  }, []);

  useEffect(() => {
    return subscribeToMenuBarState((state) => {
      setMenuBarState(state);
      if (state.mode === "default") {
        setDropHoverProjectId(null);
      }
    });
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.workspaceState?.isOpen) || projects.find((project) => project.status === "active") || null,
    [projects]
  );
  const isDropMode = menuBarState.mode === "drop";
  const hasStagedTrayDrop = menuBarState.stagedDropFiles.length > 0;

  const clearMessages = useCallback(() => {
    setFeedbackMessage(null);
    setErrorMessage(null);
  }, []);

  const handleProjectOpen = useCallback(
    async (project: Project) => {
      setBusyProjectId(project.id);
      clearMessages();
      try {
        await showApp({
          projectId: project.id,
          view: "canvas",
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not open project.");
      } finally {
        setBusyProjectId(null);
      }
    },
    [clearMessages]
  );

  const finishImport = useCallback(
    async (
      project: Project,
      options:
        | {
            files: File[];
            redirectToCanvas: boolean;
          }
        | {
            useStagedDropFiles: true;
            redirectToCanvas: boolean;
          }
    ) => {
      setBusyProjectId(project.id);
      clearMessages();

      try {
        const result =
          "files" in options
            ? await importAssetsToProjectCanvas(project.id, {
                files: options.files,
                redirectToCanvas: options.redirectToCanvas,
              })
            : await importAssetsToProjectCanvas(project.id, {
                useStagedDropFiles: true,
                redirectToCanvas: options.redirectToCanvas,
              });

        const addedCount = result.insertedNodeIds.length;
        setFeedbackMessage(
          addedCount === 1 ? `Added 1 asset node to ${project.name}.` : `Added ${addedCount} asset nodes to ${project.name}.`
        );
        setDropHoverProjectId(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not add files to project.");
      } finally {
        setBusyProjectId(null);
      }
    },
    [clearMessages]
  );

  const handleProjectClick = useCallback(
    async (project: Project, event: MouseEvent<HTMLButtonElement>) => {
      if (isDropMode && hasStagedTrayDrop) {
        await finishImport(project, {
          useStagedDropFiles: true,
          redirectToCanvas: !event.shiftKey,
        });
        return;
      }

      if (isDropMode) {
        return;
      }

      await handleProjectOpen(project);
    },
    [finishImport, handleProjectOpen, hasStagedTrayDrop, isDropMode]
  );

  const handleRowDragOver = useCallback((projectId: string, event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropHoverProjectId(projectId);
  }, []);

  const handleRowDragLeave = useCallback((projectId: string) => {
    setDropHoverProjectId((current) => (current === projectId ? null : current));
  }, []);

  const handleProjectDrop = useCallback(
    async (project: Project, event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      setDropHoverProjectId(null);

      if (files.length === 0) {
        return;
      }

      await finishImport(project, {
        files,
        redirectToCanvas: !event.shiftKey,
      });
    },
    [finishImport]
  );

  const handleDismissDropMode = useCallback(async () => {
    await dismissMenuBarDropState();
    clearMessages();
  }, [clearMessages]);

  const handleOpenApp = useCallback(async () => {
    await showApp(
      activeProject
        ? {
            projectId: activeProject.id,
            view: "canvas",
          }
        : {
            view: "home",
          }
    );
  }, [activeProject]);

  const handleCreateProjectInApp = useCallback(async () => {
    setBusyProjectId("new-project");
    clearMessages();
    try {
      const project = await createProject("New Project");
      await openProject(project.id);
      await showApp({
        projectId: project.id,
        view: "canvas",
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setBusyProjectId(null);
    }
  }, [clearMessages]);

  return (
    <main className={styles.root}>
      <Panel surface="canvas-overlay" density="compact" className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <h1 className={styles.title}>{isDropMode ? "Add files to a project" : "Projects"}</h1>
            <p className={styles.subtitle}>
              {isDropMode
                ? hasStagedTrayDrop
                  ? "Choose a project to finish the tray drop."
                  : "Drop files on a project row. Hold Shift to add without opening the app."
                : "Open a project directly on its canvas."}
            </p>
          </div>
          {isDropMode ? (
            <Button
              surface="canvas-overlay"
              density="compact"
              variant="ghost"
              size="sm"
              className={styles.actionButton}
              onClick={() => void handleDismissDropMode()}
            >
              Cancel
            </Button>
          ) : null}
        </div>

        {projects.length === 0 ? (
          <EmptyState
            surface="canvas-overlay"
            density="compact"
            title="No projects yet"
            description="Create a project in the main app, or open the app home to get started."
            action={
              <div className={styles.emptyActions}>
                <Button
                  surface="canvas-overlay"
                  density="compact"
                  variant="primary"
                  className={styles.actionButton}
                  onClick={() => void handleCreateProjectInApp()}
                  disabled={busyProjectId === "new-project"}
                >
                  New Project in App
                </Button>
                <Button
                  surface="canvas-overlay"
                  density="compact"
                  variant="secondary"
                  className={styles.actionButton}
                  onClick={() => void handleOpenApp()}
                >
                  Open App
                </Button>
              </div>
            }
          />
        ) : (
          <div className={styles.projectList}>
            {projects.map((project) => {
              const isBusy = busyProjectId === project.id;
              const primaryLabel = isDropMode ? `Add to ${project.name}` : project.name;
              return (
                <button
                  key={project.id}
                  type="button"
                  className={styles.projectButton}
                  data-drop-hovered={dropHoverProjectId === project.id}
                  onClick={(event) => void handleProjectClick(project, event)}
                  onDragOver={(event) => handleRowDragOver(project.id, event)}
                  onDragLeave={() => handleRowDragLeave(project.id)}
                  onDrop={(event) => void handleProjectDrop(project, event)}
                  disabled={isBusy}
                >
                  <span className={styles.projectCopy}>
                    <span className={styles.projectName}>{primaryLabel}</span>
                    <span className={styles.projectMeta}>
                      {project.workspaceState?.isOpen ? "Currently open" : project.status === "archived" ? "Archived" : "Project"}
                    </span>
                  </span>
                  {project.workspaceState?.isOpen ? (
                    <Badge surface="canvas-overlay" density="compact" variant="accent" className={styles.projectBadge}>
                      Open
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {isDropMode && menuBarState.stagedDropFiles.length > 0 ? (
          <div className={styles.helperRow}>
            <Badge surface="canvas-overlay" density="compact" variant="info" className={styles.projectBadge}>
              {menuBarState.stagedDropFiles.length} staged
            </Badge>
            <span>
              {menuBarState.stagedDropFiles.slice(0, 2).map((file) => file.name).join(", ")}
              {menuBarState.stagedDropFiles.length > 2 ? ` +${menuBarState.stagedDropFiles.length - 2}` : ""}
            </span>
          </div>
        ) : null}

        {feedbackMessage ? <div className={styles.success}>{feedbackMessage}</div> : null}
        {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}

        <div className={styles.footer}>
          <Button
            surface="canvas-overlay"
            density="compact"
            variant="secondary"
            className={styles.actionButton}
            onClick={() => void handleOpenApp()}
          >
            Open App
          </Button>
          <Button
            surface="canvas-overlay"
            density="compact"
            variant="ghost"
            className={styles.actionButton}
            onClick={() => void quitApp()}
          >
            Quit
          </Button>
        </div>
      </Panel>
    </main>
  );
}
