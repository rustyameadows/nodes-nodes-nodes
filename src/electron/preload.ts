import { contextBridge, ipcRenderer } from "electron";
import type { AppEventName, AppEventPayload, MenuCommand, NodeInterface } from "@/lib/ipc-contract";

const APP_EVENT_CHANNEL = "node-interface:event";
const APP_INVOKE_CHANNEL = "node-interface:invoke";
const MENU_COMMAND_CHANNEL = "node-interface:menu-command";

function invoke<T>(method: string, ...args: unknown[]) {
  return ipcRenderer.invoke(APP_INVOKE_CHANNEL, method, ...args) as Promise<T>;
}

const nodeInterface: NodeInterface = {
  listProjects: () => invoke("listProjects"),
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
  listJobs: (projectId) => invoke("listJobs", projectId),
  createJob: (projectId, payload) => invoke("createJob", projectId, payload),
  getJobDebug: (projectId, jobId) => invoke("getJobDebug", projectId, jobId),
  listProviders: () => invoke("listProviders"),
  listProviderCredentials: () => invoke("listProviderCredentials"),
  saveProviderCredential: (key, value) => invoke("saveProviderCredential", key, value),
  clearProviderCredential: (key) => invoke("clearProviderCredential", key),
  setMenuContext: (context) => invoke("setMenuContext", context),
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
};

contextBridge.exposeInMainWorld("nodeInterface", nodeInterface);
