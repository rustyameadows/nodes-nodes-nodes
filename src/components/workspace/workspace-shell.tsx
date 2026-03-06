"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace-shell.module.css";
import { getProjects, openProject, summarizeQueue } from "@/components/workspace/client-api";
import type { Job, MenuFlyoutState, Project, QueueSummary, WorkspaceView } from "@/components/workspace/types";

type Props = {
  projectId: string;
  view: WorkspaceView;
  jobs?: Job[];
  showQueuePill?: boolean;
  queuePillPlacement?: "bottom-right" | "top-right";
  children: React.ReactNode;
};

function buildProjectRoute(projectId: string, view: WorkspaceView) {
  return `/projects/${projectId}/${view}`;
}

export function WorkspaceShell({
  projectId,
  view,
  jobs = [],
  showQueuePill = false,
  queuePillPlacement = "bottom-right",
  children,
}: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [menuState, setMenuState] = useState<MenuFlyoutState>({
    open: false,
    projectsOpen: false,
  });
  const [canHover, setCanHover] = useState(false);

  const closeTimer = useRef<NodeJS.Timeout | null>(null);

  const queueSummary: QueueSummary = useMemo(() => summarizeQueue(jobs), [jobs]);

  const activeProjects = useMemo(() => projects.filter((project) => project.status === "active"), [projects]);
  const archivedProjects = useMemo(() => projects.filter((project) => project.status === "archived"), [projects]);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projects, projectId]
  );

  const refreshProjects = useCallback(async () => {
    try {
      const nextProjects = await getProjects();
      setProjects(nextProjects);
    } catch (error) {
      console.error("Failed to load projects", error);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    return () => {
      mediaQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    refreshProjects().catch(console.error);

    const handler = () => {
      refreshProjects().catch(console.error);
    };

    window.addEventListener("workspace-projects-changed", handler as EventListener);

    return () => {
      window.removeEventListener("workspace-projects-changed", handler as EventListener);
    };
  }, [refreshProjects]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }

    if (!currentProject) {
      const fallback = projects.find((project) => project.status === "active") || projects[0];
      if (fallback) {
        router.replace(buildProjectRoute(fallback.id, view));
      }
    }
  }, [currentProject, projects, router, view]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    };
  }, []);

  const closeMenuSoon = useCallback(() => {
    if (!canHover) {
      return;
    }

    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
    }

    closeTimer.current = setTimeout(() => {
      setMenuState({ open: false, projectsOpen: false });
    }, 180);
  }, [canHover]);

  const openMenu = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
    }

    setMenuState((prev) => ({ ...prev, open: true }));
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuState((prev) => ({
      open: !prev.open,
      projectsOpen: !prev.open ? prev.projectsOpen : false,
    }));
  }, []);

  const navigateView = useCallback(
    (nextView: WorkspaceView) => {
      router.push(buildProjectRoute(projectId, nextView));
      setMenuState({ open: false, projectsOpen: false });
    },
    [projectId, router]
  );

  const handleOpenProject = useCallback(
    async (targetProjectId: string) => {
      try {
        await openProject(targetProjectId);
        router.push(buildProjectRoute(targetProjectId, view));
        setMenuState({ open: false, projectsOpen: false });
        window.dispatchEvent(new Event("workspace-projects-changed"));
      } catch (error) {
        console.error("Failed to open project", error);
      }
    },
    [router, view]
  );

  return (
    <div
      className={styles.workspaceRoot}
      style={view === "canvas" ? ({ "--workspace-shell-corner-radius": "0px" } as CSSProperties) : undefined}
    >
      <div className={styles.workspaceContent}>{children}</div>

      <div
        className={styles.menuContainer}
        onMouseEnter={() => {
          if (canHover) {
            openMenu();
          }
        }}
        onMouseLeave={closeMenuSoon}
      >
        <button
          type="button"
          className={styles.menuPill}
          onClick={() => {
            if (!canHover) {
              toggleMenu();
              return;
            }

            openMenu();
          }}
        >
          Menu
        </button>

        {menuState.open && (
          <div className={styles.menuPanel}>
            <div className={styles.menuSectionLabel}>Views</div>
            <button
              type="button"
              className={view === "canvas" ? styles.menuItemActive : styles.menuItem}
              onClick={() => navigateView("canvas")}
            >
              Canvas
            </button>
            <button
              type="button"
              className={view === "assets" ? styles.menuItemActive : styles.menuItem}
              onClick={() => navigateView("assets")}
            >
              Assets
            </button>
            <button
              type="button"
              className={view === "queue" ? styles.menuItemActive : styles.menuItem}
              onClick={() => navigateView("queue")}
            >
              Queue
            </button>
            <button
              type="button"
              className={view === "settings" ? styles.menuItemActive : styles.menuItem}
              onClick={() => navigateView("settings")}
            >
              Project Settings
            </button>

            <div
              className={styles.projectsRow}
              onMouseEnter={() => {
                if (canHover) {
                  setMenuState((prev) => ({ ...prev, projectsOpen: true }));
                }
              }}
              onClick={() => {
                if (!canHover) {
                  setMenuState((prev) => ({ ...prev, projectsOpen: !prev.projectsOpen }));
                }
              }}
            >
              <span>Projects</span>
              <span>{menuState.projectsOpen ? "▾" : "▸"}</span>
            </div>

            {menuState.projectsOpen && (
              <div className={styles.projectsFlyout}>
                <div className={styles.menuSectionLabel}>Active</div>
                {activeProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={project.id === projectId ? styles.menuProjectActive : styles.menuProject}
                    onClick={() => handleOpenProject(project.id)}
                  >
                    {project.name}
                  </button>
                ))}

                <div className={styles.menuSectionLabel}>Archived</div>
                {archivedProjects.length === 0 ? (
                  <span className={styles.projectsEmpty}>None</span>
                ) : (
                  archivedProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={project.id === projectId ? styles.menuProjectActive : styles.menuProject}
                      onClick={() => handleOpenProject(project.id)}
                    >
                      {project.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showQueuePill && (
        <button
          type="button"
          className={`${styles.queuePill} ${
            queuePillPlacement === "top-right" ? styles.queuePillTopRight : styles.queuePillBottomRight
          }`}
          onClick={() => {
            router.push(buildProjectRoute(projectId, "queue"));
          }}
        >
          <span>Queue</span>
          <strong>{queueSummary.running} running</strong>
          <em>{queueSummary.queued} queued</em>
        </button>
      )}

      {!currentProject && projects.length > 0 && <div className={styles.redirectHint}>Switching project...</div>}
    </div>
  );
}
