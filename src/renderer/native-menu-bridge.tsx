import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createProject,
  getProjects,
  importProjectAssets,
  openProject,
  setDesktopMenuContext,
  subscribeToMenuCommand,
} from "@/components/workspace/client-api";
import type { Project, WorkspaceView } from "@/components/workspace/types";
import { queryKeys } from "@/renderer/query";
import { useRouter } from "@/renderer/navigation";
import {
  buildAppHomeRoute,
  buildAppSettingsRoute,
  buildNodeLibraryRoute,
  buildWorkspaceRoute,
  inferWorkspaceRoute,
} from "@/renderer/workspace-route";
import { publishCanvasMenuCommand } from "@/renderer/canvas-menu-command-bus";
import { subscribeToCanvasMenuState } from "@/renderer/canvas-menu-context-bus";
import { useLocation } from "@tanstack/react-router";

function resolveTargetProject(projects: Project[], routeProjectId: string | null) {
  if (routeProjectId) {
    return projects.find((project) => project.id === routeProjectId) || null;
  }

  return (
    projects.find((project) => project.workspaceState?.isOpen) ||
    projects.find((project) => project.status === "active") ||
    projects[0] ||
    null
  );
}

export function NativeMenuBridge() {
  const router = useRouter();
  const location = useLocation();
  const [canvasMenuState, setCanvasMenuState] = useState({
    selectedNodeCount: 0,
    canConnectSelected: false,
    canDuplicateSelected: false,
    canUndo: false,
    canRedo: false,
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: getProjects,
  });

  const routeState = useMemo(() => inferWorkspaceRoute(location.pathname), [location.pathname]);
  const targetProject = useMemo(
    () => resolveTargetProject(projects, routeState.projectId),
    [projects, routeState.projectId]
  );

  const menuContext = useMemo(
    () => ({
      projectId: targetProject?.id || null,
      view: routeState.view,
      hasProjects: projects.length > 0,
      selectedNodeCount: routeState.view === "canvas" ? canvasMenuState.selectedNodeCount : 0,
      canConnectSelected: routeState.view === "canvas" ? canvasMenuState.canConnectSelected : false,
      canDuplicateSelected: routeState.view === "canvas" ? canvasMenuState.canDuplicateSelected : false,
      canUndo: routeState.view === "canvas" ? canvasMenuState.canUndo : false,
      canRedo: routeState.view === "canvas" ? canvasMenuState.canRedo : false,
    }),
    [canvasMenuState, projects.length, routeState.view, targetProject?.id]
  );

  useEffect(() => {
    void setDesktopMenuContext(menuContext).catch((error) => {
      console.error("Failed to sync native menu context", error);
    });
  }, [menuContext]);

  useEffect(() => {
    return subscribeToCanvasMenuState((nextState) => {
      setCanvasMenuState(nextState);
    });
  }, []);

  const resolveCurrentView = useCallback(
    (): WorkspaceView =>
      routeState.view &&
      routeState.view !== "app-settings" &&
      routeState.view !== "home" &&
      routeState.view !== "nodes" &&
      routeState.view !== "node-detail"
        ? routeState.view
        : "canvas",
    [routeState.view]
  );

  const resolveTargetProjectId = useCallback(() => targetProject?.id || null, [targetProject?.id]);

  const handleNewProject = useCallback(async () => {
    const project = await createProject("New Project");
    await openProject(project.id);
    router.push(buildWorkspaceRoute(project.id, "canvas"));
  }, [router]);

  const handleOpenProject = useCallback(
    async (projectId: string) => {
      await openProject(projectId);
      router.push(buildWorkspaceRoute(projectId, resolveCurrentView()));
    },
    [resolveCurrentView, router]
  );

  const handleOpenView = useCallback(
    (view: WorkspaceView) => {
      const projectId = resolveTargetProjectId();
      if (!projectId) {
        router.push(buildAppHomeRoute());
        return;
      }

      router.push(buildWorkspaceRoute(projectId, view));
    },
    [resolveTargetProjectId, router]
  );

  const handleOpenSettings = useCallback(() => {
    const projectId = resolveTargetProjectId();
    if (!projectId) {
      router.push(buildAppHomeRoute());
      return;
    }

    router.push(buildWorkspaceRoute(projectId, "settings"));
  }, [resolveTargetProjectId, router]);

  const handleOpenHome = useCallback(() => {
    router.push(buildAppHomeRoute());
  }, [router]);

  const handleOpenAppSettings = useCallback(() => {
    router.push(buildAppSettingsRoute());
  }, [router]);

  const handleOpenNodeLibrary = useCallback(() => {
    router.push(buildNodeLibraryRoute());
  }, [router]);

  const handleImportAssets = useCallback(async () => {
    const projectId = resolveTargetProjectId();
    if (!projectId) {
      return;
    }

    await importProjectAssets(projectId);
  }, [resolveTargetProjectId]);

  useEffect(() => {
    const unsubscribe = subscribeToMenuCommand((command) => {
      if (command.type === "project.new") {
        void handleNewProject().catch((error) => {
          console.error("Failed to create project from native menu", error);
        });
        return;
      }

      if (command.type === "project.open") {
        void handleOpenProject(command.projectId).catch((error) => {
          console.error("Failed to open project from native menu", error);
        });
        return;
      }

      if (command.type === "app.home") {
        handleOpenHome();
        return;
      }

      if (command.type === "app.settings") {
        handleOpenAppSettings();
        return;
      }

      if (command.type === "app.node-library") {
        handleOpenNodeLibrary();
        return;
      }

      if (command.type === "project.settings") {
        handleOpenSettings();
        return;
      }

      if (command.type === "view.open") {
        handleOpenView(command.view);
        return;
      }

      if (command.type === "assets.import") {
        void handleImportAssets().catch((error) => {
          console.error("Failed to import assets from native menu", error);
        });
        return;
      }

      publishCanvasMenuCommand(command);
    });

    return unsubscribe;
  }, [
    handleImportAssets,
    handleNewProject,
    handleOpenAppSettings,
    handleOpenHome,
    handleOpenNodeLibrary,
    handleOpenProject,
    handleOpenSettings,
    handleOpenView,
  ]);

  return null;
}
