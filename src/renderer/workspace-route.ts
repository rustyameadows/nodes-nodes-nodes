import type { WorkspaceView } from "@/components/workspace/types";

export function buildWorkspaceRoute(projectId: string, view: WorkspaceView) {
  return `/projects/${projectId}/${view}`;
}

export function inferWorkspaceRoute(pathname: string) {
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
    view: (view || "canvas") as WorkspaceView,
  } as const;
}
