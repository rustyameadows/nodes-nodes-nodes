import type { AppRouteView, WorkspaceView } from "@/components/workspace/types";

export function buildWorkspaceRoute(projectId: string, view: WorkspaceView) {
  return `/projects/${projectId}/${view}`;
}

export function buildAppHomeRoute() {
  return "/";
}

export function buildAppSettingsRoute() {
  return "/settings/app";
}

export function buildNodeLibraryRoute() {
  return "/nodes";
}

export function buildNodeLibraryDetailRoute(nodeId: string) {
  return `/nodes/${nodeId}`;
}

export function inferWorkspaceRoute(pathname: string) {
  if (pathname === buildAppHomeRoute()) {
    return {
      projectId: null,
      view: "home" as AppRouteView,
    } as const;
  }

  if (pathname === buildAppSettingsRoute()) {
    return {
      projectId: null,
      view: "app-settings" as AppRouteView,
    } as const;
  }

  if (pathname === buildNodeLibraryRoute()) {
    return {
      projectId: null,
      view: "nodes" as AppRouteView,
    } as const;
  }

  if (/^\/nodes\/[^/]+$/.test(pathname)) {
    return {
      projectId: null,
      view: "node-detail" as AppRouteView,
    } as const;
  }

  const match = pathname.match(/^\/projects\/([^/]+)(?:\/(canvas|assets|queue|settings))?(?:\/.*)?$/);
  if (!match) {
    return {
      projectId: null,
      view: null,
    } as const;
  }

  const [, projectId, view] = match;
  return {
    projectId,
    view: (view || "canvas") as AppRouteView,
  } as const;
}
