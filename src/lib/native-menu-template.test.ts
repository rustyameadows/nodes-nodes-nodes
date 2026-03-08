import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeMenuTemplate, type NativeMenuItemDescriptor } from "@/electron/native-menu";

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

test("builds project and canvas menu items with context-aware enabled states", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Node Nodes",
    isMac: true,
    isDev: false,
    context: {
      projectId: "project-1",
      view: "canvas",
      hasProjects: true,
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
  });

  assert.equal(findMenuItem(template, "file.import-assets")?.enabled, true);
  assert.equal(findMenuItem(template, "project.view.canvas")?.checked, true);
  assert.equal(findMenuItem(template, "canvas.add.model")?.enabled, true);
  assert.equal(findMenuItem(template, "project.open.project-1")?.checked, true);
  assert.equal(findMenuItem(template, "project.open.project-2")?.checked, false);
});

test("disables canvas insertion when no canvas project is active", () => {
  const template = buildNativeMenuTemplate({
    appName: "Nodes Node Nodes",
    isMac: true,
    isDev: true,
    context: {
      projectId: "project-1",
      view: "settings",
      hasProjects: true,
    },
    projects: [
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        isOpen: true,
      },
    ],
  });

  assert.equal(findMenuItem(template, "canvas.add.model")?.enabled, false);
  assert.equal(findMenuItem(template, "canvas.add.text-note")?.enabled, false);
  assert.equal(findMenuItem(template, "project.view.settings")?.checked, undefined);
  assert.equal(findMenuItem(template, "project.settings")?.checked, true);
});
