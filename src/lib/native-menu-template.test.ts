import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeMenuTemplate, type NativeMenuItemDescriptor } from "@/electron/native-menu";
import type { ProviderModel } from "@/components/workspace/types";

function findMenuItem(items: NativeMenuItemDescriptor[], itemId: string): NativeMenuItemDescriptor | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }

    const nested = item.submenu ? findMenuItem(item.submenu, itemId) : null;
    if (nested) {
      return nested;
    }
  }

  return null;
}

const providerModels: ProviderModel[] = [
  {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: true,
      availability: "ready",
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
  },
  {
    providerId: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT 5 Mini",
    capabilities: {
      text: true,
      image: false,
      video: false,
      runnable: true,
      availability: "ready",
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
  },
];

test("builds project and canvas menu items with context-aware enabled states", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Nodes Nodes",
    isMac: true,
    isDev: false,
    context: {
      projectId: "project-1",
      view: "canvas",
      hasProjects: true,
      selectedNodeCount: 2,
      canConnectSelected: true,
      canDuplicateSelected: false,
      canUndo: true,
      canRedo: true,
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        isOpen: true,
      },
      {
        id: "project-2",
        name: "Archive",
        status: "archived",
        isOpen: false,
      },
    ],
    providerModels,
  });

  assert.equal(findMenuItem(template, "file.import-assets")?.enabled, true);
  assert.equal(findMenuItem(template, "app.settings")?.accelerator, "CommandOrControl+,");
  assert.equal(findMenuItem(template, "project.home")?.enabled, true);
  assert.equal(findMenuItem(template, "project.home")?.checked, false);
  assert.equal(findMenuItem(template, "project.node-library")?.enabled, true);
  assert.equal(findMenuItem(template, "project.view.canvas")?.checked, true);
  assert.equal(findMenuItem(template, "canvas.open-insert-menu")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.open-insert-menu")?.accelerator, undefined);
  assert.equal(findMenuItem(template, "canvas.add.model")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.add.model.default")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.add.model.variant.openai.gpt-5-mini")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.connect-selected")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.connect-selected")?.accelerator, undefined);
  assert.equal(findMenuItem(template, "canvas.duplicate-selected")?.enabled, false);
  assert.equal(findMenuItem(template, "canvas.undo")?.enabled, true);
  assert.equal(findMenuItem(template, "canvas.redo")?.enabled, true);
  assert.equal(findMenuItem(template, "project.open.project-1")?.checked, true);
  assert.equal(findMenuItem(template, "project.open.project-2")?.checked, false);
  assert.equal(findMenuItem(template, "project.settings")?.accelerator, undefined);
});

test("disables canvas insertion when no canvas project is active", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Nodes Nodes",
    isMac: true,
    isDev: true,
    context: {
      projectId: "project-1",
      view: "settings",
      hasProjects: true,
      selectedNodeCount: 1,
      canConnectSelected: false,
      canDuplicateSelected: true,
      canUndo: false,
      canRedo: false,
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        isOpen: true,
      },
    ],
    providerModels,
  });

  assert.equal(findMenuItem(template, "canvas.add.model")?.enabled, false);
  assert.equal(findMenuItem(template, "canvas.add.text-note")?.enabled, false);
  assert.equal(findMenuItem(template, "canvas.connect-selected")?.enabled, false);
  assert.equal(findMenuItem(template, "canvas.undo")?.enabled, false);
  assert.equal(findMenuItem(template, "project.view.settings")?.checked, undefined);
  assert.equal(findMenuItem(template, "project.settings")?.checked, true);
});

test("keeps project-scoped actions separate from app settings", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Nodes Nodes",
    isMac: true,
    isDev: false,
    context: {
      projectId: "project-1",
      view: "app-settings",
      hasProjects: true,
      selectedNodeCount: 0,
      canConnectSelected: false,
      canDuplicateSelected: false,
      canUndo: false,
      canRedo: false,
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        isOpen: true,
      },
    ],
    providerModels,
  });

  assert.equal(findMenuItem(template, "canvas.add.model")?.enabled, false);
  assert.equal(findMenuItem(template, "project.settings")?.checked, false);
  assert.equal(findMenuItem(template, "app.settings")?.enabled, true);
});

test("keeps app-level navigation available when no projects exist", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Nodes Nodes",
    isMac: true,
    isDev: false,
    context: {
      projectId: null,
      view: "app-settings",
      hasProjects: false,
      selectedNodeCount: 0,
      canConnectSelected: false,
      canDuplicateSelected: false,
      canUndo: false,
      canRedo: false,
    },
    projects: [],
    providerModels,
  });

  assert.equal(findMenuItem(template, "project.home")?.enabled, true);
  assert.equal(findMenuItem(template, "app.settings")?.enabled, true);
  assert.equal(findMenuItem(template, "file.import-assets")?.enabled, false);
  assert.equal(findMenuItem(template, "project.settings")?.enabled, false);
});

test("marks Home as the current project menu item on the app home route", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Nodes Nodes",
    isMac: true,
    isDev: false,
    context: {
      projectId: "project-1",
      view: "home",
      hasProjects: true,
      selectedNodeCount: 0,
      canConnectSelected: false,
      canDuplicateSelected: false,
      canUndo: false,
      canRedo: false,
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        isOpen: true,
      },
    ],
    providerModels,
  });

  assert.equal(findMenuItem(template, "project.home")?.checked, true);
  assert.equal(findMenuItem(template, "project.node-library")?.checked, false);
  assert.equal(findMenuItem(template, "project.view.canvas")?.checked, false);
  assert.equal(findMenuItem(template, "project.settings")?.checked, false);
});
