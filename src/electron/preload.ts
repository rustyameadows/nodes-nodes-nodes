import { contextBridge, ipcRenderer } from "electron";
import type { AppEventName, AppEventPayload, MenuBarState, MenuCommand, NodeInterface } from "@/lib/ipc-contract";

const APP_EVENT_CHANNEL = "node-interface:event";
const APP_INVOKE_CHANNEL = "node-interface:invoke";
const MENU_COMMAND_CHANNEL = "node-interface:menu-command";
const MENU_BAR_STATE_CHANNEL = "node-interface:menu-bar-state";

function invoke<T>(method: string, ...args: unknown[]) {
  return ipcRenderer.invoke(APP_INVOKE_CHANNEL, method, ...args) as Promise<T>;
}

const nodeInterface: NodeInterface = {
  listProjects: () => invoke("listProjects"),
  getAppSettings: () => invoke("getAppSettings"),
  saveAppSettings: (settings) => invoke("saveAppSettings", settings),
  createProject: (name) => invoke("createProject", name),
  updateProject: (projectId, payload) => invoke("updateProject", projectId, payload),
  deleteProject: (projectId) => invoke("deleteProject", projectId),
  openProject: (projectId) => invoke("openProject", projectId),
  getWorkspaceSnapshot: (projectId) => invoke("getWorkspaceSnapshot", projectId),
  saveWorkspaceSnapshot: (projectId, payload) => invoke("saveWorkspaceSnapshot", projectId, payload),
  listAssets: (projectId, filters, options) => invoke("listAssets", projectId, filters, options),
  getAsset: (assetId) => invoke("getAsset", assetId),
  updateAsset: (assetId, payload) => invoke("updateAsset", assetId, payload),
  importAssets: (projectId, items) => invoke("importAssets", projectId, items),
  importAssetsToProjectCanvas: (projectId, request) => invoke("importAssetsToProjectCanvas", projectId, request),
  listJobs: (projectId) => invoke("listJobs", projectId),
  createJob: (projectId, payload) => invoke("createJob", projectId, payload),
  getJobDebug: (projectId, jobId) => invoke("getJobDebug", projectId, jobId),
  listProviders: () => invoke("listProviders"),
  listProviderCredentials: () => invoke("listProviderCredentials"),
  saveProviderCredential: (key, value) => invoke("saveProviderCredential", key, value),
  clearProviderCredential: (key) => invoke("clearProviderCredential", key),
  refreshProviderAccess: (providerId) => invoke("refreshProviderAccess", providerId),
  showApp: (target) => invoke("showApp", target),
  quitApp: () => invoke("quitApp"),
  getMenuBarState: () => invoke("getMenuBarState"),
  dismissMenuBarDropState: () => invoke("dismissMenuBarDropState"),
  setMenuContext: (context) => invoke("setMenuContext", context),
  saveCanvasPngExport: (request) => invoke("saveCanvasPngExport", request),
  subscribe: (eventName: AppEventName, listener: (payload: AppEventPayload) => void) => {
    const handler = (_event: unknown, payload: AppEventPayload) => {
      if (payload.event === eventName) {
        listener(payload);
      }
    };

    ipcRenderer.on(APP_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(APP_EVENT_CHANNEL, handler);
    };
  },
  subscribeMenuCommand: (listener: (command: MenuCommand) => void) => {
    const handler = (_event: unknown, payload: MenuCommand) => {
      listener(payload);
    };

    ipcRenderer.on(MENU_COMMAND_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(MENU_COMMAND_CHANNEL, handler);
    };
  },
  subscribeMenuBarState: (listener: (state: MenuBarState) => void) => {
    const handler = (_event: unknown, payload: MenuBarState) => {
      listener(payload);
    };

    ipcRenderer.on(MENU_BAR_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(MENU_BAR_STATE_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld("nodeInterface", nodeInterface);
