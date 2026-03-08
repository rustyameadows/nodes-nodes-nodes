import { Navigate, Outlet, createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AssetDetailView } from "@/components/workspace/views/asset-detail-view";
import { AssetsView } from "@/components/workspace/views/assets-view";
import { CanvasView } from "@/components/workspace/views/canvas-view";
import { RootRouter } from "@/components/workspace/root-router";
import { SettingsView } from "@/components/workspace/views/settings-view";
import { QueueView } from "@/components/workspace/views/queue-view";
import { NativeMenuBridge } from "@/renderer/native-menu-bridge";

function RootLayout() {
  return (
    <>
      <NativeMenuBridge />
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: RootRouter,
});

const projectCanvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/canvas",
  component: () => {
    const { projectId } = projectCanvasRoute.useParams();
    return <CanvasView projectId={projectId} />;
  },
});

const projectAssetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/assets",
  component: () => {
    const { projectId } = projectAssetsRoute.useParams();
    return <AssetsView projectId={projectId} />;
  },
});

const projectAssetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/assets/$assetId",
  component: () => {
    const { projectId, assetId } = projectAssetDetailRoute.useParams();
    return <AssetDetailView projectId={projectId} assetId={assetId} />;
  },
});

const projectQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/queue",
  component: () => {
    const { projectId } = projectQueueRoute.useParams();
    return <QueueView projectId={projectId} />;
  },
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/settings",
  component: () => {
    const { projectId } = projectSettingsRoute.useParams();
    return <SettingsView projectId={projectId} />;
  },
});

const projectRootRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: () => {
    const { projectId } = projectRootRedirectRoute.useParams();
    return <Navigate to="/projects/$projectId/canvas" params={{ projectId }} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectCanvasRoute,
  projectAssetsRoute,
  projectAssetDetailRoute,
  projectQueueRoute,
  projectSettingsRoute,
  projectRootRedirectRoute,
]);

function isDesktopFileRuntime() {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  history: isDesktopFileRuntime() ? createHashHistory() : undefined,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
