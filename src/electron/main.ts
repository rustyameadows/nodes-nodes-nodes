import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, type MenuItemConstructorOptions } from "electron";
import type { AppEventPayload, CreateJobRequest, ImportAssetInput, MenuCommand, MenuContext } from "@/lib/ipc-contract";
import type { AssetFilterState } from "@/components/workspace/types";
import { createAppIcon } from "@/electron/brand";
import { buildNativeMenuTemplate, type NativeMenuItemDescriptor } from "@/electron/native-menu";
import { APP_ID, APP_NAME, APP_USER_DATA_DIRNAME } from "@/lib/runtime/app-meta";
import { getDb } from "@/lib/db/client";
import { jobPreviewFrames } from "@/lib/db/schema";
import { readAssetContent } from "@/lib/storage/local-storage";
import { getAsset, importAssets, importAssetsFromPaths, listAssets, readAssetFile, updateAsset } from "@/lib/services/assets";
import { createJob, getJobDebug, listJobs } from "@/lib/services/jobs";
import { createProject, deleteProject, listProjects, openProject, updateProject } from "@/lib/services/projects";
import {
  clearProviderCredential,
  listProviderCredentials,
  listProviders,
  refreshProviderAccess,
  saveProviderCredential,
  syncProviderModels,
} from "@/lib/services/providers";
import { getWorkspaceSnapshot, saveWorkspaceSnapshot } from "@/lib/services/workspace";

const APP_EVENT_CHANNEL = "node-interface:event";
const APP_INVOKE_CHANNEL = "node-interface:invoke";
const MENU_COMMAND_CHANNEL = "node-interface:menu-command";

let mainWindow: BrowserWindow | null = null;
let workerProcess: ChildProcess | null = null;
let isQuitting = false;
const menuContextByWebContentsId = new Map<number, MenuContext>();
const defaultMenuContext: MenuContext = {
  projectId: null,
  view: null,
  hasProjects: false,
  selectedNodeCount: 0,
  canConnectSelected: false,
  canDuplicateSelected: false,
  canUndo: false,
  canRedo: false,
};

function configureStableUserDataPath() {
  if (process.env.NODE_INTERFACE_APP_DATA) {
    return;
  }

  // Keep desktop data on a stable on-disk path that does not move when display
  // branding changes. This preserves existing local SQLite/assets storage.
  const stableUserDataPath = path.join(app.getPath("appData"), APP_USER_DATA_DIRNAME);
  mkdirSync(stableUserDataPath, { recursive: true });
  app.setPath("userData", stableUserDataPath);
}

function ensureAppEnvironment() {
  if (!process.env.NODE_INTERFACE_APP_DATA) {
    process.env.NODE_INTERFACE_APP_DATA = path.join(app.getPath("appData"), APP_USER_DATA_DIRNAME, "node-interface-demo");
  }
}

function applyAppBranding() {
  const appIcon = createAppIcon();

  app.setName(APP_NAME);
  process.title = APP_NAME;

  if (process.platform === "darwin") {
    app.dock.setIcon(appIcon);
  }

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationIdentifier: APP_ID,
    applicationVersion: app.getVersion(),
  });

  return appIcon;
}

function broadcastEvent(payload: AppEventPayload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }

    window.webContents.send(APP_EVENT_CHANNEL, payload);
  }
}

function isUsableWindow(window: BrowserWindow | null) {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function getMenuTargetWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (isUsableWindow(focusedWindow)) {
    return focusedWindow;
  }

  if (isUsableWindow(mainWindow)) {
    return mainWindow;
  }

  return BrowserWindow.getAllWindows().find((window) => isUsableWindow(window)) || null;
}

function emitMenuCommand(command: MenuCommand, window = getMenuTargetWindow()) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.send(MENU_COMMAND_CHANNEL, command);
}

function mapMenuDescriptorToElectronItem(descriptor: NativeMenuItemDescriptor): MenuItemConstructorOptions {
  if (descriptor.type === "separator") {
    return { type: "separator" };
  }

  const item: MenuItemConstructorOptions = {
    ...(descriptor.id ? { id: descriptor.id } : {}),
    ...(descriptor.label ? { label: descriptor.label } : {}),
    ...(descriptor.role ? { role: descriptor.role as MenuItemConstructorOptions["role"] } : {}),
    ...(descriptor.accelerator ? { accelerator: descriptor.accelerator } : {}),
    ...(typeof descriptor.enabled === "boolean" ? { enabled: descriptor.enabled } : {}),
    ...(typeof descriptor.checked === "boolean" ? { checked: descriptor.checked } : {}),
    ...(descriptor.type ? { type: descriptor.type } : {}),
    ...(descriptor.submenu
      ? {
          submenu: descriptor.submenu.map((itemDescriptor) => mapMenuDescriptorToElectronItem(itemDescriptor)),
        }
      : {}),
  };

  if (descriptor.command) {
    item.click = () => {
      emitMenuCommand(descriptor.command);
    };
  }

  return item;
}

async function refreshApplicationMenu() {
  try {
    const targetWindow = getMenuTargetWindow();
    const context = targetWindow
      ? menuContextByWebContentsId.get(targetWindow.webContents.id) || defaultMenuContext
      : defaultMenuContext;
    const [projects, providerModels] = await Promise.all([listProjects(), listProviders()]);
    const template = buildNativeMenuTemplate({
      appName: APP_NAME,
      isMac: process.platform === "darwin",
      isDev: process.env.NODE_ENV === "development",
      context: {
        ...context,
        hasProjects: context.hasProjects || projects.length > 0,
      },
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        isOpen: Boolean(project.workspaceState?.isOpen),
      })),
      providerModels,
    });

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(template.map((descriptor) => mapMenuDescriptorToElectronItem(descriptor)))
    );
  } catch (error) {
    console.error("Failed to refresh application menu", error);
  }
}

async function createWindow() {
  const appIcon = createAppIcon();
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#060606",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow = window;
  const webContentsId = window.webContents.id;

  window.on("focus", () => {
    void refreshApplicationMenu();
  });

  window.on("closed", () => {
    menuContextByWebContentsId.delete(webContentsId);
    if (mainWindow === window) {
      mainWindow = null;
    }
    void refreshApplicationMenu();
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} (${validatedUrl})`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer:gone]", details.reason, details.exitCode);
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    if (!window.isDestroyed()) {
      window.setTitle(APP_NAME);
    }
  });

  if (process.env.NODE_ENV === "development") {
    window.webContents.on("did-finish-load", async () => {
      try {
        const state = await window.webContents.executeJavaScript(`
          ({
            title: document.title,
            bodyText: document.body?.innerText?.slice(0, 200) || "",
            hasNodeInterface: Boolean(window.nodeInterface),
          })
        `);
        console.log("[renderer:ready]", state);
      } catch (error) {
        console.error("[renderer:ready-check-failed]", error);
      }
    });
  }

  if (process.env.NODE_ENV === "development") {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL || "http://localhost:5173");
    window.webContents.openDevTools({ mode: "detach" });
    await refreshApplicationMenu();
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  await refreshApplicationMenu();
}

async function handleAssetProtocol(request: Request) {
  const url = new URL(request.url);

  if (url.host === "asset") {
    const assetId = url.pathname.replace(/^\/+/, "");
    const asset = await getAsset(assetId);
    const file = await readAssetFile(asset.storageRef, asset.mimeType);
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.host === "preview") {
    const previewFrameId = url.pathname.replace(/^\/+/, "");
    const previewFrame = getDb().select().from(jobPreviewFrames).where(eq(jobPreviewFrames.id, previewFrameId)).get();
    if (!previewFrame) {
      return new Response("Preview frame not found", { status: 404 });
    }

    const file = await readAssetContent(previewFrame.storageRef);
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": previewFrame.mimeType,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

async function startWorker() {
  workerProcess = fork(path.join(__dirname, "worker.cjs"), {
    env: {
      ...process.env,
      NODE_INTERFACE_APP_DATA: process.env.NODE_INTERFACE_APP_DATA,
    },
  });

  workerProcess.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const payload = message as { type?: string; event?: AppEventPayload["event"]; projectId?: string };
    if (payload.type === "event" && payload.event) {
      broadcastEvent({
        event: payload.event,
        projectId: payload.projectId,
      });
    }
  });

  workerProcess.on("exit", () => {
    workerProcess = null;
    if (!isQuitting) {
      void startWorker();
    }
  });
}

function registerIpc() {
  const handlers = {
    listProjects: async () => listProjects(),
    createProject: async (name: string) => {
      const project = await createProject(name);
      broadcastEvent({ event: "projects.changed", projectId: project.id });
      broadcastEvent({ event: "workspace.changed", projectId: project.id });
      await refreshApplicationMenu();
      return project;
    },
    updateProject: async (projectId: string, payload: { name?: string; status?: "active" | "archived" }) => {
      const project = await updateProject(projectId, payload);
      broadcastEvent({ event: "projects.changed", projectId });
      await refreshApplicationMenu();
      return project;
    },
    deleteProject: async (projectId: string) => {
      await deleteProject(projectId);
      broadcastEvent({ event: "projects.changed", projectId });
      await refreshApplicationMenu();
    },
    openProject: async (projectId: string) => {
      await openProject(projectId);
      broadcastEvent({ event: "projects.changed", projectId });
      broadcastEvent({ event: "workspace.changed", projectId });
      await refreshApplicationMenu();
    },
    getWorkspaceSnapshot: async (projectId: string) => getWorkspaceSnapshot(projectId),
    saveWorkspaceSnapshot: async (
      projectId: string,
      payload: {
        canvasDocument: Record<string, unknown>;
        assetViewerLayout?: "grid" | "compare_2" | "compare_4";
        filterState?: Record<string, unknown>;
      }
    ) => {
      await saveWorkspaceSnapshot(projectId, payload);
      broadcastEvent({ event: "workspace.changed", projectId });
    },
    listAssets: async (
      projectId: string,
      filters: AssetFilterState,
      options?: {
        origin?: "all" | "uploaded" | "generated";
        query?: string;
      }
    ) => listAssets(projectId, filters, options),
    getAsset: async (assetId: string) => getAsset(assetId),
    updateAsset: async (assetId: string, payload: { rating?: number | null; flagged?: boolean; tags?: string[] }) => {
      const asset = await updateAsset(assetId, payload);
      broadcastEvent({ event: "assets.changed", projectId: asset.projectId });
      return asset;
    },
    importAssets: async (projectId: string, items?: ImportAssetInput[]) => {
      let imported;

      if (items && items.length > 0) {
        imported = await importAssets(
          projectId,
          items.map((item) => ({
            name: item.name,
            mimeType: item.mimeType,
            buffer: Buffer.from(item.content),
          }))
        );
      } else {
        const selected = await dialog.showOpenDialog(mainWindow || undefined, {
          properties: ["openFile", "multiSelections"],
        });
        if (selected.canceled || selected.filePaths.length === 0) {
          return [];
        }
        imported = await importAssetsFromPaths(projectId, selected.filePaths);
      }

      broadcastEvent({ event: "assets.changed", projectId });
      return imported;
    },
    listJobs: async (projectId: string) => listJobs(projectId),
    createJob: async (projectId: string, payload: CreateJobRequest) => {
      const job = await createJob(projectId, payload);
      broadcastEvent({ event: "jobs.changed", projectId });
      return job;
    },
    getJobDebug: async (projectId: string, jobId: string) => getJobDebug(projectId, jobId),
    listProviders: async () => listProviders(),
    listProviderCredentials: async () => listProviderCredentials(),
    saveProviderCredential: async (key: "OPENAI_API_KEY" | "GOOGLE_API_KEY" | "TOPAZ_API_KEY", value: string) => {
      await saveProviderCredential(key, value);
      broadcastEvent({ event: "providers.changed" });
    },
    clearProviderCredential: async (key: "OPENAI_API_KEY" | "GOOGLE_API_KEY" | "TOPAZ_API_KEY") => {
      await clearProviderCredential(key);
      broadcastEvent({ event: "providers.changed" });
    },
    refreshProviderAccess: async (providerId?: "openai" | "google-gemini" | "topaz") => {
      await refreshProviderAccess(providerId);
      broadcastEvent({ event: "providers.changed" });
    },
    setMenuContext: async (context: MenuContext, webContentsId?: number) => {
      if (!webContentsId) {
        return;
      }

      menuContextByWebContentsId.set(webContentsId, context);
      await refreshApplicationMenu();
    },
  } as const;

  ipcMain.handle(APP_INVOKE_CHANNEL, async (event, method: keyof typeof handlers, ...args: unknown[]) => {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unknown node interface method: ${String(method)}`);
    }

    if (method === "setMenuContext") {
      return handlers.setMenuContext(args[0] as MenuContext, event.sender.id);
    }

    return handler(...(args as never[]));
  });
}

configureStableUserDataPath();

app.whenReady().then(async () => {
  ensureAppEnvironment();
  applyAppBranding();
  await syncProviderModels({ refreshAccess: true });
  protocol.handle("app-asset", handleAssetProtocol);
  registerIpc();
  await startWorker();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  workerProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
