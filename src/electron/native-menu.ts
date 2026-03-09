import type { ProviderModel } from "@/components/workspace/types";
import { getDefaultModelCatalogVariant, getInsertableNodeCatalogEntries, groupModelCatalogVariants } from "@/lib/node-catalog";
import type { MenuCommand, MenuContext } from "@/lib/ipc-contract";

export type NativeMenuProject = {
  id: string;
  name: string;
  status: "active" | "archived";
  isOpen: boolean;
};

export type NativeMenuItemDescriptor = {
  id?: string;
  label?: string;
  role?: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  type?: "normal" | "separator" | "checkbox";
  submenu?: NativeMenuItemDescriptor[];
  command?: MenuCommand;
};

type BuildNativeMenuTemplateOptions = {
  appName: string;
  isMac: boolean;
  isDev: boolean;
  context: MenuContext;
  projects: NativeMenuProject[];
  providerModels: ProviderModel[];
};

function buildProjectItems(projects: NativeMenuProject[]) {
  if (projects.length === 0) {
    return [
      {
        id: "project.none",
        label: "None",
        enabled: false,
      },
    ] satisfies NativeMenuItemDescriptor[];
  }

  return projects.map((project) => ({
    id: `project.open.${project.id}`,
    label: project.name,
    type: "checkbox" as const,
    checked: project.isOpen,
    enabled: true,
    command: {
      type: "project.open" as const,
      projectId: project.id,
    },
  }));
}

export function buildNativeMenuTemplate({
  appName,
  isMac,
  isDev,
  context,
  projects,
  providerModels,
}: BuildNativeMenuTemplateOptions): NativeMenuItemDescriptor[] {
  const hasActiveProject = Boolean(context.projectId);
  const hasCanvasProject = hasActiveProject && context.view === "canvas";
  const isNodeLibraryView = context.view === "nodes" || context.view === "node-detail";
  const activeProjects = projects.filter((project) => project.status === "active");
  const archivedProjects = projects.filter((project) => project.status === "archived");
  const modelVariantGroups = groupModelCatalogVariants(providerModels);
  const defaultModelVariant = getDefaultModelCatalogVariant(providerModels);
  const canvasInsertEntries = getInsertableNodeCatalogEntries("canvas", providerModels);

  const template: NativeMenuItemDescriptor[] = [];

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: "app.settings",
          label: "App Settings…",
          accelerator: "CommandOrControl+,",
          enabled: true,
          command: { type: "app.settings" },
        },
        {
          id: "app.node-library",
          label: "Node Library",
          enabled: true,
          command: { type: "app.node-library" },
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          id: "file.new-project",
          label: "New Project",
          accelerator: "CommandOrControl+N",
          enabled: true,
          command: { type: "project.new" },
        },
        {
          id: "file.import-assets",
          label: "Import Assets…",
          enabled: hasActiveProject,
          command: { type: "assets.import" },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Project",
      submenu: [
        {
          id: "project.home",
          label: "Home",
          type: "checkbox",
          checked: context.view === "home",
          enabled: true,
          command: { type: "app.home" },
        },
        {
          id: "project.node-library",
          label: "Node Library",
          type: "checkbox",
          checked: isNodeLibraryView,
          enabled: true,
          command: { type: "app.node-library" },
        },
        { type: "separator" },
        {
          id: "project.view.canvas",
          label: "Canvas",
          type: "checkbox",
          checked: context.view === "canvas",
          enabled: context.hasProjects,
          command: { type: "view.open", view: "canvas" },
        },
        {
          id: "project.view.assets",
          label: "Assets",
          type: "checkbox",
          checked: context.view === "assets",
          enabled: context.hasProjects,
          command: { type: "view.open", view: "assets" },
        },
        {
          id: "project.view.queue",
          label: "Queue",
          type: "checkbox",
          checked: context.view === "queue",
          enabled: context.hasProjects,
          command: { type: "view.open", view: "queue" },
        },
        {
          id: "project.settings",
          label: "Project Settings",
          type: "checkbox",
          checked: context.view === "settings",
          enabled: context.hasProjects,
          command: { type: "project.settings" },
        },
        { type: "separator" },
        {
          id: "project.active-projects",
          label: "Active Projects",
          submenu: buildProjectItems(activeProjects),
        },
        {
          id: "project.archived-projects",
          label: "Archived Projects",
          submenu: buildProjectItems(archivedProjects),
        },
      ],
    },
    {
      label: "Canvas",
      submenu: [
        {
          id: "canvas.open-insert-menu",
          label: "Add Node…",
          enabled: hasCanvasProject,
          command: { type: "canvas.open-insert-menu" },
        },
        { type: "separator" },
        {
          id: "canvas.add.model",
          label: "Add Model Node",
          enabled: hasCanvasProject,
          submenu: [
            {
              id: "canvas.add.model.default",
              label: `${defaultModelVariant.providerLabel} · ${defaultModelVariant.label}`,
              enabled: hasCanvasProject,
              command: {
                type: "canvas.add-node",
                nodeType: "model",
                providerId: defaultModelVariant.providerId,
                modelId: defaultModelVariant.modelId,
              },
            },
            { type: "separator" },
            ...Object.entries(modelVariantGroups).map(([providerId, variants]) => ({
              id: `canvas.add.model.provider.${providerId}`,
              label: variants[0]?.providerLabel || providerId,
              submenu: variants.map((variant) => ({
                id: `canvas.add.model.variant.${variant.providerId}.${variant.modelId}`,
                label: variant.label,
                enabled: hasCanvasProject,
                command: {
                  type: "canvas.add-node",
                  nodeType: "model",
                  providerId: variant.providerId,
                  modelId: variant.modelId,
                },
              })),
            })),
          ],
        },
        ...canvasInsertEntries
          .filter((entry) => entry.id !== "model")
          .map((entry) => ({
            id: `canvas.add.${entry.id}`,
            label:
              entry.id === "asset-uploaded"
                ? "Add Uploaded Asset"
                : entry.id === "asset-generated"
                  ? "Add Generated Asset"
                  : `Add ${entry.label}`,
            enabled: hasCanvasProject,
            command: {
              type: "canvas.add-node",
              nodeType: entry.id,
            } as MenuCommand,
          })),
        { type: "separator" },
        {
          id: "canvas.connect-selected",
          label: "Connect Selected Nodes",
          enabled: hasCanvasProject && context.canConnectSelected,
          command: { type: "canvas.connect-selected" },
        },
        {
          id: "canvas.duplicate-selected",
          label: "Duplicate Selected Node",
          accelerator: "CommandOrControl+D",
          enabled: hasCanvasProject && context.canDuplicateSelected,
          command: { type: "canvas.duplicate-selected" },
        },
        { type: "separator" },
        {
          id: "canvas.undo",
          label: "Undo Canvas Change",
          accelerator: "CommandOrControl+Z",
          enabled: hasCanvasProject && context.canUndo,
          command: { type: "canvas.undo" },
        },
        {
          id: "canvas.redo",
          label: "Redo Canvas Change",
          accelerator: "Shift+CommandOrControl+Z",
          enabled: hasCanvasProject && context.canRedo,
          command: { type: "canvas.redo" },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev
          ? [
              { type: "separator" as const },
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" as const }, { role: "front" }] : [{ role: "close" }]),
      ],
    }
  );

  return template;
}
