import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, chromium, type Browser, type Page } from "playwright";

const APP_NAME = "Nodes Nodes Nodes";
const PACKAGED_REMOTE_DEBUGGING_PORT = 9339;
const FILTERS = {
  type: "all" as const,
  ratingAtLeast: 0,
  flaggedOnly: false,
  tag: "",
  providerId: "all" as const,
  sort: "newest" as const,
};

type RuntimeController = {
  getPage: () => Promise<Page>;
  getMetadata: () => Promise<{ name: string; version: string; exePath: string }>;
  getNativeMenuLabels?: () => Promise<string[]>;
  getNativeMenuItemState?: (itemId: string) => Promise<{ enabled: boolean; accelerator?: string }>;
  triggerNativeMenuItem?: (itemId: string) => Promise<void>;
  close: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function projectRoutePattern(projectId?: string, view?: "canvas" | "assets" | "queue" | "settings") {
  if (projectId && view) {
    return new RegExp(`#?/projects/${projectId}/${view}$`);
  }

  if (view) {
    return new RegExp(`#?/projects/[^/]+/${view}$`);
  }

  return /#?\/projects\/[^/]+$/;
}

function appSettingsRoutePattern() {
  return /#?\/settings\/app$/;
}

function appHomeRoutePattern() {
  return /#?\/$/;
}

type SmokeCanvasNode = {
  id: string;
  label: string;
  prompt: string;
  x: number;
  y: number;
  promptSourceNodeId: string | null;
  upstreamNodeIds: string[];
};

function getRequiredCanvasNodeId(nodes: SmokeCanvasNode[], label: string) {
  const node = nodes.find((candidate) => candidate.label === label);
  assert.ok(node, `Expected canvas node with label "${label}".`);
  return node.id;
}

async function getCanvasNodes(window: Page, projectId: string) {
  return window.evaluate(async (activeProjectId) => {
    const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
    const nodes = Array.isArray(
      (snapshot.canvas?.canvasDocument as { workflow?: { nodes?: SmokeCanvasNode[] } } | null)?.workflow?.nodes
    )
      ? ((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: SmokeCanvasNode[] } }).workflow?.nodes || [])
      : [];
    return nodes;
  }, projectId);
}

async function clickCanvasNode(window: Page, label: string, options?: { shiftKey?: boolean; doubleClick?: boolean }) {
  const node = window.locator("div[role='button']").filter({ hasText: label }).first();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  const box = await node.boundingBox();
  assert.ok(box, `Expected canvas node bounds for ${label}.`);
  const clickX = box.x + box.width / 2;
  const clickY = box.y + box.height / 2;

  if (options?.shiftKey) {
    await window.keyboard.down("Shift");
  }

  if (options?.doubleClick) {
    await window.mouse.dblclick(clickX, clickY);
  } else {
    await window.mouse.click(clickX, clickY);
  }

  if (options?.shiftKey) {
    await window.keyboard.up("Shift");
  }
}

function getCanvasNodeLocator(window: Page, label: string) {
  const inputMatch = window
    .locator("div[role='button']")
    .filter({ has: window.locator(`input[value="${label}"]`) });
  const textMatch = window.locator("div[role='button']").filter({ hasText: label });

  return inputMatch.or(textMatch).first();
}

async function screenshotCanvasNode(window: Page, label: string, outputPath: string) {
  const node = getCanvasNodeLocator(window, label);
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await node.screenshot({ path: outputPath });
}

async function blurActiveElement(window: Page) {
  await window.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  });
}

function getPackagedExecutablePath() {
  return path.resolve("release", "mac-arm64", `${APP_NAME}.app`, "Contents", "MacOS", APP_NAME);
}

function isPackagedMacMode() {
  return process.argv.includes("--packaged-mac");
}

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function captureFailureState(window: Page | null, appDataRoot: string) {
  if (!window) {
    return;
  }

  try {
    await window.screenshot({
      path: path.join(appDataRoot, "failure.png"),
      fullPage: true,
    });
    console.error("Failure screenshot:", path.join(appDataRoot, "failure.png"));
    console.error("Failure URL:", window.url());
    console.error("Failure HTML:");
    console.error(await window.locator("body").innerHTML());
  } catch (error) {
    console.error("Failed to capture failure state:", error);
  }
}

async function openMenuItem(window: Page, itemName: string) {
  await window.getByRole("button", { name: "Menu" }).click();
  await window.getByRole("button", { name: itemName }).click();
}

async function triggerWorkspaceView(
  runtime: RuntimeController,
  window: Page,
  itemId: string,
  itemName: "Home" | "Assets" | "Queue" | "Project Settings" | "App Settings"
) {
  if (runtime.triggerNativeMenuItem) {
    await runtime.triggerNativeMenuItem(itemId);
    return;
  }

  await openMenuItem(window, itemName);
}

async function readPackageVersion() {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version?: string };
  return pkg.version || "0.0.0";
}

async function waitForElectronPage(browser: Browser) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => !candidate.url().startsWith("devtools://"));

    if (page) {
      return page;
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for the packaged Electron window.");
}

async function launchPackagedRuntime(launchTarget: string, appDataRoot: string): Promise<RuntimeController> {
  const packageVersion = await readPackageVersion();
  const child = spawn(launchTarget, [`--remote-debugging-port=${PACKAGED_REMOTE_DEBUGGING_PORT}`], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_INTERFACE_APP_DATA: appDataRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const browser = await withTimeout(
    "chromium.connectOverCDP",
    (async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (child.exitCode !== null) {
          throw new Error(`Packaged app exited before CDP attach.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        }

        try {
          return await chromium.connectOverCDP(`http://127.0.0.1:${PACKAGED_REMOTE_DEBUGGING_PORT}`);
        } catch {
          await sleep(500);
        }
      }

      throw new Error(`Timed out connecting to the packaged app over CDP.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    })(),
    35_000
  );

  return {
    getPage: async () => waitForElectronPage(browser),
    getMetadata: async () => ({
      name: APP_NAME,
      version: packageVersion,
      exePath: launchTarget,
    }),
    close: async () => {
      await browser.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await withTimeout(
          "packaged child exit",
          new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            setTimeout(() => resolve(), 5_000);
          }),
          6_000
        );
      }
    },
  };
}

async function launchUnpackagedRuntime(launchTarget: string, appDataRoot: string): Promise<RuntimeController> {
  const electronApp = await withTimeout(
    "electron.launch",
    electron.launch({
      args: [launchTarget],
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_INTERFACE_APP_DATA: appDataRoot,
      },
    }),
    30_000
  );

  return {
    getPage: async () => electronApp.firstWindow(),
    getMetadata: async () =>
      withTimeout(
        "electron.appMetadata",
        electronApp.evaluate(({ app }) => ({
          name: app.getName(),
          version: app.getVersion(),
          exePath: app.getPath("exe"),
        })),
        15_000
      ),
    getNativeMenuLabels: async () =>
      withTimeout(
        "electron.menuLabels",
        electronApp.evaluate(({ Menu }) => {
          const menu = Menu.getApplicationMenu();
          return (menu?.items || []).map((item) => item.label).filter((label): label is string => Boolean(label));
        }),
        15_000
      ),
    getNativeMenuItemState: async (itemId: string) =>
      withTimeout(
        `electron.menuItemState.${itemId}`,
        electronApp.evaluate(
          ({ Menu }, targetItemId) => {
            const menu = Menu.getApplicationMenu();
            if (!menu) {
              throw new Error("Application menu is unavailable.");
            }

            const stack = [...menu.items];
            while (stack.length > 0) {
              const candidate = stack.shift() as
                | {
                    id: string;
                    enabled: boolean;
                    accelerator?: string;
                    submenu?: { items: unknown[] } | null;
                  }
                | undefined;

              if (!candidate) {
                continue;
              }

              if (candidate.id === targetItemId) {
                return {
                  enabled: candidate.enabled,
                  accelerator: candidate.accelerator,
                };
              }

              const submenuItems = (candidate.submenu?.items || []) as Array<{
                id: string;
                enabled: boolean;
                accelerator?: string;
                submenu?: { items: unknown[] } | null;
              }>;
              stack.unshift(...submenuItems);
            }

            throw new Error(`Menu item not found: ${targetItemId}`);
          },
          itemId
        ),
        15_000
      ),
    triggerNativeMenuItem: async (itemId: string) =>
      withTimeout(
        `electron.menuItem.${itemId}`,
        electronApp.evaluate(
          ({ BrowserWindow, Menu }, targetItemId) => {
            const menu = Menu.getApplicationMenu();
            if (!menu) {
              throw new Error("Application menu is unavailable.");
            }

            const stack = [...menu.items];
            let item:
              | {
                  id: string;
                  click?: ((menuItem: unknown, browserWindow: unknown, event: unknown) => void) | undefined;
                  submenu?: { items: unknown[] } | null;
                }
              | undefined;

            while (stack.length > 0) {
              const candidate = stack.shift() as
                | {
                    id: string;
                    click?: ((menuItem: unknown, browserWindow: unknown, event: unknown) => void) | undefined;
                    submenu?: { items: unknown[] } | null;
                  }
                | undefined;

              if (!candidate) {
                continue;
              }

              if (candidate.id === targetItemId) {
                item = candidate;
                break;
              }

              const submenuItems = (candidate.submenu?.items || []) as Array<{
                id: string;
                click?: ((menuItem: unknown, browserWindow: unknown, event: unknown) => void) | undefined;
                submenu?: { items: unknown[] } | null;
              }>;
              stack.unshift(...submenuItems);
            }

            if (!item || !item.click) {
              throw new Error(`Menu item not found or not clickable: ${targetItemId}`);
            }

            item.click(undefined, BrowserWindow.getFocusedWindow() || undefined, undefined);
          },
          itemId
        ),
        15_000
      ),
    close: async () => {
      await electronApp.close();
    },
  };
}

async function launchRuntime(launchTarget: string, appDataRoot: string) {
  if (isPackagedMacMode()) {
    return launchPackagedRuntime(launchTarget, appDataRoot);
  }

  return launchUnpackagedRuntime(launchTarget, appDataRoot);
}

async function main() {
  const runtimeMode = isPackagedMacMode() ? "packaged-mac" : "unpackaged";
  const appDataRoot = await mkdtemp(path.join(os.tmpdir(), `node-interface-smoke-${runtimeMode}-`));
  const canvasScreenshotPath = path.join(appDataRoot, "canvas-smoke.png");
  const modelPreviewScreenshotPath = path.join(appDataRoot, "canvas-model-preview.png");
  const modelFullScreenshotPath = path.join(appDataRoot, "canvas-model-full.png");
  const templateFullScreenshotPath = path.join(appDataRoot, "canvas-template-full.png");
  const listFullScreenshotPath = path.join(appDataRoot, "canvas-list-full.png");
  const resizedAssetScreenshotPath = path.join(appDataRoot, "canvas-resized-asset.png");
  const assetsScreenshotPath = path.join(appDataRoot, "assets-smoke.png");
  const queueScreenshotPath = path.join(appDataRoot, "queue-smoke.png");
  const projectSettingsScreenshotPath = path.join(appDataRoot, "project-settings-smoke.png");
  const appSettingsScreenshotPath = path.join(appDataRoot, "app-settings-smoke.png");
  const launchTarget = isPackagedMacMode() ? getPackagedExecutablePath() : path.resolve("dist/electron/main.cjs");

  await access(launchTarget);
  console.log("Smoke runtime mode:", runtimeMode);
  console.log("Smoke app data root:", appDataRoot);
  console.log("Smoke launch target:", launchTarget);

  const runtime = await launchRuntime(launchTarget, appDataRoot);
  let window: Page | null = null;

  try {
    console.log("Electron launched");
    const appMetadata = await runtime.getMetadata();
    assert.equal(appMetadata.name, APP_NAME, "Expected branded app name.");
    if (isPackagedMacMode()) {
      assert.match(
        appMetadata.exePath,
        /Nodes Nodes Nodes\.app\/Contents\/MacOS\/Nodes Nodes Nodes$/,
        "Expected packaged executable path."
      );
    }
    console.log("App metadata:", JSON.stringify(appMetadata, null, 2));

    window = await withTimeout("runtime.firstWindow", runtime.getPage(), 30_000);
    window.on("console", (message) => {
      console.log(`[window:${message.type()}]`, message.text());
    });

    await withTimeout("window.domcontentloaded", window.waitForLoadState("domcontentloaded"), 30_000);
    assert.equal(await window.title(), APP_NAME, "Expected branded window title.");
    console.log("Window loaded:", await window.title(), window.url());

    await withTimeout(
      "window.nodeInterface",
      window.waitForFunction(() => Boolean(window.nodeInterface), undefined, { timeout: 15_000 })
    );
    console.log("Preload bridge detected");

    if (runtime.getNativeMenuLabels) {
      const nativeMenuLabels = await runtime.getNativeMenuLabels();
      assert.ok(nativeMenuLabels.includes("File"), "Expected File menu.");
      assert.ok(nativeMenuLabels.includes("Project"), "Expected Project menu.");
      assert.ok(nativeMenuLabels.includes("Canvas"), "Expected Canvas menu.");
      assert.ok(nativeMenuLabels.includes("View"), "Expected View menu.");
      assert.ok(nativeMenuLabels.includes("Window"), "Expected Window menu.");
      console.log("Native menu verified:", nativeMenuLabels.join(", "));
    }

    const providerSummary = await window.evaluate(async () => {
      const providers = await window.nodeInterface.listProviders();
      return providers
        .filter((model) => ["openai", "topaz", "google-gemini"].includes(model.providerId))
        .map((model) => ({
          providerId: model.providerId,
          modelId: model.modelId,
          runnable: model.capabilities.runnable,
          requirements: model.capabilities.requirements || [],
        }));
    });
    console.log("Provider readiness:", JSON.stringify(providerSummary, null, 2));

    await withTimeout(
      "app home heading",
      window.getByRole("heading", { name: "App Home" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("App home rendered");

    await withTimeout(
      "home app settings button",
      window.getByRole("button", { name: "App Settings" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.getByRole("button", { name: "App Settings" }).click();
    await withTimeout("app settings route", window.waitForURL(appSettingsRoutePattern()));
    await withTimeout(
      "app settings heading",
      window.getByRole("heading", { name: "App Settings" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await withTimeout(
      "provider credentials heading",
      window.getByRole("heading", { name: "Provider Credentials" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Home app settings entry point verified");

    await window.getByRole("button", { name: "Back to Home" }).click();
    await withTimeout(
      "home return",
      window.getByRole("heading", { name: "App Home" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Returned to app home from app settings");

    if (runtime.triggerNativeMenuItem) {
      await runtime.triggerNativeMenuItem("file.new-project");
    } else {
      await window.getByRole("button", { name: "Create Project" }).click();
    }
    await withTimeout("canvas route", window.waitForURL(projectRoutePattern(undefined, "canvas")));
    console.log("Project created and canvas route loaded:", window.url());

    const projectId = await window.evaluate(() => {
      const currentUrl = `${window.location.pathname}${window.location.hash}`;
      return currentUrl.match(/\/projects\/([^/]+)/)?.[1] || "";
    });
    assert.ok(projectId, "Expected a project id in the canvas route.");
    console.log("Active project:", projectId);

    if (runtime.triggerNativeMenuItem) {
      await runtime.triggerNativeMenuItem("canvas.add.model");
      await withTimeout(
        "native menu canvas insert",
        window.waitForFunction(
          async (activeProjectId) => {
            const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
            const nodes = ((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: unknown[] } } | null)?.workflow?.nodes ||
              []) as unknown[];
            return nodes.length >= 1;
          },
          projectId,
          { timeout: 15_000 }
        )
      );
      console.log("Native Canvas menu insertion verified");
    }

    const nodeLabels = await window.evaluate(async ({ activeProjectId }) => {
      await window.nodeInterface.saveWorkspaceSnapshot(activeProjectId, {
        canvasDocument: {
          canvasViewport: {
            x: 0,
            y: 0,
            zoom: 1,
          },
          workflow: {
            nodes: [
              {
                id: "smoke-text-note",
                label: "Smoke Prompt",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "text-note",
                nodeType: "text-note",
                outputType: "text",
                prompt: "Draw a red square on a blue background.",
                settings: {
                  source: "text-note",
                },
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: null,
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 120,
                y: 120,
              },
              {
                id: "smoke-model-node",
                label: "Smoke Image Model",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "model",
                nodeType: "image-gen",
                outputType: "image",
                prompt: "",
                settings: {},
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: null,
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 420,
                y: 120,
              },
              {
                id: "smoke-list-node",
                label: "Smoke List",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "list",
                nodeType: "list",
                outputType: "text",
                prompt: "",
                settings: {
                  source: "list",
                  columns: [
                    { id: "smoke-col-animal", label: "Animal" },
                    { id: "smoke-col-habitat", label: "Habitat" },
                    { id: "smoke-col-trait", label: "Trait" },
                  ],
                  rows: [
                    {
                      id: "smoke-row-1",
                      values: {
                        "smoke-col-animal": "Otter",
                        "smoke-col-habitat": "River",
                        "smoke-col-trait": "Curious",
                      },
                    },
                    {
                      id: "smoke-row-2",
                      values: {
                        "smoke-col-animal": "Fox",
                        "smoke-col-habitat": "Forest",
                        "smoke-col-trait": "Playful",
                      },
                    },
                  ],
                },
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: null,
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 120,
                y: 340,
              },
              {
                id: "smoke-template-node",
                label: "Smoke Template",
                providerId: "openai",
                modelId: "gpt-image-1.5",
                kind: "text-template",
                nodeType: "text-template",
                outputType: "text",
                prompt: "Illustrate a [[Animal]] in a [[Habitat]] with a [[Trait]] expression.",
                settings: {
                  source: "text-template",
                },
                sourceAssetId: null,
                sourceAssetMimeType: null,
                sourceJobId: null,
                sourceOutputIndex: null,
                processingState: null,
                promptSourceNodeId: null,
                upstreamNodeIds: ["smoke-list-node"],
                upstreamAssetIds: ["node:smoke-list-node"],
                x: 470,
                y: 340,
              },
            ],
          },
        },
      });

      const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
      const nodes = Array.isArray((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: Array<{ label?: string }> } } | null)?.workflow?.nodes)
        ? ((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: Array<{ label?: string }> } }).workflow?.nodes || [])
        : [];

      return nodes.map((node) => node.label || "");
    }, { activeProjectId: projectId });

    assert.deepEqual(nodeLabels, ["Smoke Prompt", "Smoke Image Model", "Smoke List", "Smoke Template"]);
    console.log("Canvas snapshot round-trip verified");

    await window.reload();
    await withTimeout("canvas reload", window.waitForLoadState("domcontentloaded"));
    await window.waitForTimeout(800);
    await withTimeout(
      "canvas test hook",
      window.waitForFunction(
        () =>
          Boolean(
            (window as typeof window & {
              __NND_CANVAS_TEST__?: unknown;
            }).__NND_CANVAS_TEST__
          ),
        undefined,
        { timeout: 15_000 }
      )
    );

    await window.keyboard.press("a");
    await withTimeout(
      "canvas insert menu via keyboard",
      window.getByRole("button", { name: "Add Model Node" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.keyboard.press("Escape");
    console.log("Canvas keyboard shortcut A verified");

    const interactionNodes = await getCanvasNodes(window, projectId);
    const promptNodeId = getRequiredCanvasNodeId(interactionNodes, "Smoke Prompt");
    const modelNodeId = getRequiredCanvasNodeId(interactionNodes, "Smoke Image Model");
    const listNodeId = getRequiredCanvasNodeId(interactionNodes, "Smoke List");
    const templateNodeId = getRequiredCanvasNodeId(interactionNodes, "Smoke Template");
    const modelNode = window.locator("div[role='button']").filter({ hasText: "Smoke Image Model" }).first();
    await modelNode.waitFor({ state: "visible", timeout: 15_000 });
    await screenshotCanvasNode(window, "Smoke Image Model", modelPreviewScreenshotPath);
    console.log("Model preview screenshot:", modelPreviewScreenshotPath);
    await withTimeout(
      "canvas nodes after reload",
      window.waitForFunction(
        async (activeProjectId) => {
          const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
          const nodes = ((snapshot.canvas?.canvasDocument as { workflow?: { nodes?: unknown[] } } | null)?.workflow?.nodes ||
            []) as unknown[];
          return nodes.length >= 4;
        },
        projectId,
        { timeout: 15_000 }
      )
    );
    await window.evaluate((nodeIds: string[]) => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          selectNodes: (nodeIds: string[]) => void;
          getState: () => { selectedNodeIds: string[] };
        };
      }).__NND_CANVAS_TEST__;
      api?.selectNodes(nodeIds);
    }, [promptNodeId, modelNodeId]);
    await window.waitForTimeout(150);
    const multiSelectCount = await window.evaluate(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: { getState: () => { selectedNodeIds: string[] } };
      }).__NND_CANVAS_TEST__;
      return api?.getState().selectedNodeIds.length || 0;
    });
    assert.equal(multiSelectCount, 2, "Expected two selected nodes in canvas test hook state.");

    await window.evaluate(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: { moveSelectedNodesBy: (deltaX: number, deltaY: number) => void };
      }).__NND_CANVAS_TEST__;
      api?.moveSelectedNodesBy(96, 72);
    });
    await window.waitForTimeout(900);

    const movedNodes = await getCanvasNodes(window, projectId);
    const movedPromptNode = movedNodes.find((node) => node.id === promptNodeId);
    const movedModelNode = movedNodes.find((node) => node.id === modelNodeId);
    assert.ok(movedPromptNode && movedModelNode, "Expected moved smoke nodes.");
    const movedDeltaX = movedPromptNode.x - 120;
    const movedDeltaY = movedPromptNode.y - 120;
    assert.notEqual(movedDeltaX, 0, "Expected group drag to move the prompt node.");
    assert.notEqual(movedDeltaY, 0, "Expected group drag to move the prompt node vertically.");
    assert.equal(movedModelNode.x - 420, movedDeltaX, "Expected group drag to preserve relative X spacing.");
    assert.equal(movedModelNode.y - 120, movedDeltaY, "Expected group drag to preserve relative Y spacing.");
    console.log("Canvas multi-node drag verified");

    await window.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await window.waitForTimeout(900);
    const undoMoveNodes = await getCanvasNodes(window, projectId);
    assert.equal(undoMoveNodes.find((node) => node.id === promptNodeId)?.x, 120);
    assert.equal(undoMoveNodes.find((node) => node.id === modelNodeId)?.x, 420);
    await window.keyboard.press(`${process.platform === "darwin" ? "Meta+Shift" : "Control+Shift"}+z`);
    await window.waitForTimeout(900);
    const redoMoveNodes = await getCanvasNodes(window, projectId);
    assert.equal(redoMoveNodes.find((node) => node.id === promptNodeId)?.x, movedPromptNode.x);
    assert.equal(redoMoveNodes.find((node) => node.id === modelNodeId)?.x, movedModelNode.x);
    console.log("Canvas undo/redo for batch move verified");

    await window.evaluate((nodeIds: string[]) => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          selectNodes: (nodeIds: string[]) => void;
          getState: () => { selectedNodeIds: string[] };
        };
      }).__NND_CANVAS_TEST__;
      api?.selectNodes(nodeIds);
    }, [promptNodeId, modelNodeId]);
    await window.waitForTimeout(150);
    const reselectedCount = await window.evaluate(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: { getState: () => { selectedNodeIds: string[] } };
      }).__NND_CANVAS_TEST__;
      return api?.getState().selectedNodeIds.length || 0;
    });
    assert.equal(reselectedCount, 2, "Expected two selected nodes before connect shortcut.");
    await blurActiveElement(window);
    await window.keyboard.press("c");
    await window.waitForTimeout(900);

    const connectedNodes = await getCanvasNodes(window, projectId);
    assert.equal(
      connectedNodes.find((node) => node.id === modelNodeId)?.promptSourceNodeId,
      promptNodeId,
      "Expected C shortcut to connect oldest selected node into newest selected node."
    );
    console.log("Canvas keyboard shortcut C verified");

    await window.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await window.waitForTimeout(900);
    const disconnectedNodes = await getCanvasNodes(window, projectId);
    assert.equal(disconnectedNodes.find((node) => node.id === modelNodeId)?.promptSourceNodeId, null);
    await window.keyboard.press(`${process.platform === "darwin" ? "Meta+Shift" : "Control+Shift"}+z`);
    await window.waitForTimeout(900);
    const reconnectedNodes = await getCanvasNodes(window, projectId);
    assert.equal(reconnectedNodes.find((node) => node.id === modelNodeId)?.promptSourceNodeId, promptNodeId);
    console.log("Canvas undo/redo for connection verified");

    await window.evaluate((nodeId: string) => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          selectNodes: (nodeIds: string[]) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.selectNodes([nodeId]);
    }, modelNodeId);
    await window.waitForTimeout(150);
    await clickCanvasNode(window, "Smoke Image Model");
    const singleSelectCount = await window.evaluate(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: { getState: () => { selectedNodeIds: string[] } };
      }).__NND_CANVAS_TEST__;
      return api?.getState().selectedNodeIds.length || 0;
    });
    assert.equal(singleSelectCount, 1, "Expected one selected node before Enter shortcut.");
    const modelNodeButton = window.locator("div[role='button']").filter({ hasText: "Smoke Image Model" }).first();
    await modelNodeButton.focus();
    await window.keyboard.press("Enter");
    const promptEditor = window.locator('textarea[placeholder="Describe what to generate"]').first();
    try {
      await promptEditor.waitFor({ state: "visible", timeout: 1_500 });
    } catch {
      await window.evaluate((nodeId: string) => {
        const api = (window as typeof window & {
          __NND_CANVAS_TEST__?: {
            openPrimaryEditor: (targetNodeId: string) => void;
          };
        }).__NND_CANVAS_TEST__;
        api?.openPrimaryEditor(nodeId);
      }, modelNodeId);
    }
    await withTimeout(
      "model prompt editor",
      promptEditor.waitFor({ state: "visible", timeout: 15_000 })
    );
    await screenshotCanvasNode(window, "Smoke Image Model", modelFullScreenshotPath);
    console.log("Model full screenshot:", modelFullScreenshotPath);
    await promptEditor.click();
    await promptEditor.fill("");
    const nodeCountBeforeFocusedShortcutTyping = (await getCanvasNodes(window, projectId)).length;
    await window.keyboard.type("ac");
    await window.keyboard.press("Enter");
    await window.keyboard.type("z");
    await window.keyboard.press("Backspace");
    assert.equal(await promptEditor.inputValue(), "ac\n");
    assert.equal(
      await window.getByRole("button", { name: "Add List" }).count(),
      0,
      "Expected insert menu to stay closed while typing in the prompt editor."
    );
    assert.equal(
      (await getCanvasNodes(window, projectId)).length,
      nodeCountBeforeFocusedShortcutTyping,
      "Expected canvas delete shortcuts to stay disabled while the prompt editor is focused."
    );
    console.log("Canvas shortcuts stay suppressed while typing in the prompt editor");
    await promptEditor.fill("Updated smoke prompt from inline full node");
    await blurActiveElement(window);
    await window.mouse.click(48, 48);
    await window.waitForTimeout(900);
    const editedNodes = await getCanvasNodes(window, projectId);
    assert.equal(
      editedNodes.find((node) => node.id === modelNodeId)?.prompt,
      "Updated smoke prompt from inline full node"
    );
    console.log("Canvas Enter shortcut and inline full-node edit verified");

    await window.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await window.waitForTimeout(900);
    const undoPromptNodes = await getCanvasNodes(window, projectId);
    assert.equal(undoPromptNodes.find((node) => node.id === modelNodeId)?.prompt, "");
    await window.keyboard.press(`${process.platform === "darwin" ? "Meta+Shift" : "Control+Shift"}+z`);
    await window.waitForTimeout(900);
    const redoPromptNodes = await getCanvasNodes(window, projectId);
    assert.equal(
      redoPromptNodes.find((node) => node.id === modelNodeId)?.prompt,
      "Updated smoke prompt from inline full node"
    );
    console.log("Canvas undo/redo for inline full-node edit verified");

    await clickCanvasNode(window, "Draw a red square on a blue background.", { doubleClick: true });
    await withTimeout(
      "note editor via double click",
      window.locator('textarea[placeholder="Write note text"]').waitFor({ state: "visible", timeout: 15_000 })
    );
    await blurActiveElement(window);
    await window.mouse.click(48, 48);
    await blurActiveElement(window);
    console.log("Canvas node double-click editor verified");

    await blurActiveElement(window);
    await window.keyboard.press("a");
    await withTimeout(
      "canvas insert menu before add note",
      window.getByRole("button", { name: "Add Text Note" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.getByRole("button", { name: "Add Text Note" }).click();
    await window.waitForTimeout(900);
    const addedNodes = await getCanvasNodes(window, projectId);
    assert.equal(addedNodes.length, 5, "Expected Add Node menu to insert a fifth node.");
    await window.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await window.waitForTimeout(900);
    assert.equal((await getCanvasNodes(window, projectId)).length, 4, "Expected undo to remove inserted node.");
    await window.keyboard.press(`${process.platform === "darwin" ? "Meta+Shift" : "Control+Shift"}+z`);
    await window.waitForTimeout(900);
    assert.equal((await getCanvasNodes(window, projectId)).length, 5, "Expected redo to restore inserted node.");

    await clickCanvasNode(window, "Smoke List");
    const listNodeButton = window.locator("div[role='button']").filter({ hasText: "Smoke List" }).first();
    await listNodeButton.focus();
    await window.keyboard.press("Enter");
    try {
      await window.getByRole("button", { name: "Add column", exact: true }).waitFor({ state: "visible", timeout: 1_500 });
    } catch {
      await window.evaluate((nodeId: string) => {
        const api = (window as typeof window & {
          __NND_CANVAS_TEST__?: {
            openPrimaryEditor: (nodeId: string) => void;
          };
        }).__NND_CANVAS_TEST__;
        api?.openPrimaryEditor(nodeId);
      }, listNodeId);
    }
    await withTimeout(
      "list editor",
      window.getByRole("button", { name: "Add column", exact: true }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await screenshotCanvasNode(window, "Smoke List", listFullScreenshotPath);
    console.log("List full screenshot:", listFullScreenshotPath);
    const listColumnInput = window.locator('input[placeholder="Column 1"]').first();
    await listColumnInput.click();
    await window.keyboard.type("a");
    assert.equal(
      await listColumnInput.inputValue(),
      "Animala",
      "Expected list column input to keep typed characters while focused."
    );
    assert.equal(
      await window.getByRole("button", { name: "Add List" }).count(),
      0,
      "Expected insert menu to stay closed while typing in the list editor."
    );
    console.log("Canvas add-node menu and list sheet editor verified");

    await window.evaluate((nodeId: string) => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          openPrimaryEditor: (nodeId: string) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.openPrimaryEditor(nodeId);
    }, templateNodeId);
    await withTimeout(
      "template editor",
      window.locator('textarea[placeholder="Write template with [[variables]]"]').waitFor({ state: "visible", timeout: 15_000 })
    );
    await screenshotCanvasNode(window, "Smoke Template", templateFullScreenshotPath);
    console.log("Template full screenshot:", templateFullScreenshotPath);

    await window.screenshot({ path: canvasScreenshotPath, fullPage: true });
    console.log("Canvas screenshot:", canvasScreenshotPath);

    const importedAssets = await window.evaluate(async ({ activeProjectId }) => {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
          <rect width="320" height="200" fill="#0b0b0b" />
          <circle cx="100" cy="100" r="56" fill="#ff4fa2" />
          <rect x="160" y="44" width="96" height="112" rx="12" fill="#4ea4ff" />
        </svg>
      `.trim();

      return window.nodeInterface.importAssets(activeProjectId, [
        {
          name: "smoke.svg",
          mimeType: "image/svg+xml",
          content: new TextEncoder().encode(svg).buffer,
        },
      ]);
    }, { activeProjectId: projectId });

    assert.equal(importedAssets.length, 1, "Expected one imported asset.");
    console.log("Asset import verified");

    const assetCount = await window.evaluate(async ({ activeProjectId, filters }) => {
      const assets = await window.nodeInterface.listAssets(activeProjectId, filters);
      return assets.length;
    }, { activeProjectId: projectId, filters: FILTERS });

    assert.equal(assetCount, 1, "Expected one asset after import.");
    console.log("Asset listing verified");

    const assetNodeId = await window.evaluate(async ({ activeProjectId, assetId }) => {
      const snapshot = await window.nodeInterface.getWorkspaceSnapshot(activeProjectId);
      const canvasDocument = (snapshot.canvas?.canvasDocument || {
        canvasViewport: { x: 0, y: 0, zoom: 1 },
        workflow: { nodes: [] },
      }) as {
        canvasViewport: { x: number; y: number; zoom: number };
        workflow: { nodes: Array<Record<string, unknown>> };
      };

      const nextNodeId = "smoke-uploaded-asset-node";
      const nextNodes = [
        ...canvasDocument.workflow.nodes,
        {
          id: nextNodeId,
          label: "Smoke Uploaded Asset",
          providerId: "openai",
          modelId: "gpt-image-1.5",
          kind: "asset-source",
          nodeType: "transform",
          outputType: "image",
          prompt: "",
          settings: {
            source: "upload",
          },
          sourceAssetId: assetId,
          sourceAssetMimeType: "image/svg+xml",
          sourceJobId: null,
          sourceOutputIndex: null,
          processingState: null,
          promptSourceNodeId: null,
          upstreamNodeIds: [],
          upstreamAssetIds: [],
          x: 820,
          y: 160,
          displayMode: "preview",
          size: null,
        },
      ];

      await window.nodeInterface.saveWorkspaceSnapshot(activeProjectId, {
        canvasDocument: {
          ...canvasDocument,
          workflow: {
            nodes: nextNodes,
          },
        },
      });

      return nextNodeId;
    }, { activeProjectId: projectId, assetId: importedAssets[0]!.id });

    await window.reload();
    await withTimeout("canvas reload with uploaded asset", window.waitForLoadState("domcontentloaded"));
    await withTimeout(
      "canvas hook after uploaded asset",
      window.waitForFunction(
        () =>
          Boolean(
            (window as typeof window & {
              __NND_CANVAS_TEST__?: unknown;
            }).__NND_CANVAS_TEST__
          ),
        undefined,
        { timeout: 15_000 }
      )
    );
    await window.evaluate(
      ({ nodeId }) => {
        const api = (window as typeof window & {
          __NND_CANVAS_TEST__?: {
            selectNodes: (nodeIds: string[]) => void;
            resizeNode: (nodeId: string, size: { width: number; height: number }) => void;
          };
        }).__NND_CANVAS_TEST__;
        api?.selectNodes([nodeId]);
        api?.resizeNode(nodeId, { width: 320, height: 236 });
      },
      { nodeId: assetNodeId }
    );
    await window.waitForTimeout(900);
    const assetBeforeDrag = await getCanvasNodes(window, projectId);
    const assetBeforeDragNode = assetBeforeDrag.find((node) => node.id === assetNodeId);
    assert.ok(assetBeforeDragNode, "Expected uploaded asset node before drag.");
    const assetNodeLocator = getCanvasNodeLocator(window, "Smoke Uploaded Asset");
    await assetNodeLocator.waitFor({ state: "visible", timeout: 15_000 });
    const assetBox = await assetNodeLocator.boundingBox();
    assert.ok(assetBox, "Expected resized asset node bounds.");
    await window.mouse.move(assetBox.x + assetBox.width / 2, assetBox.y + assetBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(assetBox.x + assetBox.width / 2 + 88, assetBox.y + assetBox.height / 2 + 52);
    await window.mouse.up();
    await window.waitForTimeout(900);
    const assetAfterDrag = await getCanvasNodes(window, projectId);
    const assetAfterDragNode = assetAfterDrag.find((node) => node.id === assetNodeId);
    assert.ok(assetAfterDragNode, "Expected uploaded asset node after drag.");
    assert.notEqual(assetAfterDragNode.x, assetBeforeDragNode.x, "Expected resized asset node to move after drag.");
    assert.notEqual(assetAfterDragNode.y, assetBeforeDragNode.y, "Expected resized asset node to move vertically after drag.");
    await screenshotCanvasNode(window, "Smoke Uploaded Asset", resizedAssetScreenshotPath);
    console.log("Resized asset screenshot:", resizedAssetScreenshotPath);

    await triggerWorkspaceView(runtime, window, "project.view.assets", "Assets");
    await withTimeout("assets route", window.waitForURL(projectRoutePattern(projectId, "assets")));
    await withTimeout(
      "asset preview",
      window.getByRole("img", { name: new RegExp(`Generated asset ${importedAssets[0]!.id}`) }).waitFor({
        state: "visible",
        timeout: 15_000,
      })
    );
    await window.waitForTimeout(800);
    await window.screenshot({ path: assetsScreenshotPath, fullPage: true });
    console.log("Assets screenshot:", assetsScreenshotPath);

    await triggerWorkspaceView(runtime, window, "project.view.queue", "Queue");
    await withTimeout("queue route", window.waitForURL(projectRoutePattern(projectId, "queue")));
    await withTimeout("queue heading", window.getByRole("heading", { name: "Queue" }).waitFor({ state: "visible", timeout: 15_000 }));
    await withTimeout(
      "queue inspector",
      window.getByRole("heading", { name: "Call Inspector" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.screenshot({ path: queueScreenshotPath, fullPage: true });
    console.log("Queue screenshot:", queueScreenshotPath);

    await triggerWorkspaceView(runtime, window, "project.settings", "Project Settings");
    await withTimeout("settings route", window.waitForURL(projectRoutePattern(projectId, "settings")));
    await withTimeout(
      "settings heading",
      window.getByRole("heading", { name: "Project Settings" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    const projectNameValue = await window.getByRole("textbox").first().inputValue();
    assert.ok(projectNameValue.trim().length > 0, "Expected a project name in settings.");
    await withTimeout(
      "provider credentials removed from project settings",
      window.waitForFunction(
        () => !Array.from(document.querySelectorAll("h1, h2")).some((element) => element.textContent?.trim() === "Provider Credentials"),
        undefined,
        { timeout: 15_000 }
      )
    );
    await window.screenshot({ path: projectSettingsScreenshotPath, fullPage: true });
    console.log("Project settings screenshot:", projectSettingsScreenshotPath);

    await openMenuItem(window, "Home");
    await withTimeout("home route from menu pill", window.waitForURL(appHomeRoutePattern()));
    await withTimeout(
      "home heading from menu pill",
      window.getByRole("heading", { name: "App Home" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Workspace Menu pill Home navigation verified");

    await window.reload();
    await withTimeout("home reload", window.waitForLoadState("domcontentloaded"));
    await withTimeout(
      "home heading after reload",
      window.getByRole("heading", { name: "App Home" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Home-first startup behavior verified after reload");

    const archivedProjectId = await window.evaluate(async () => {
      const archivedProject = await window.nodeInterface.createProject("Archived Smoke Project");
      await window.nodeInterface.updateProject(archivedProject.id, { status: "archived" });
      return archivedProject.id;
    });
    assert.ok(archivedProjectId, "Expected archived project id.");
    await withTimeout(
      "archived projects section",
      window.getByRole("heading", { name: "Archived Projects" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await withTimeout(
      "archived project card",
      window.getByRole("button", { name: "Open project Archived Smoke Project" }).waitFor({
        state: "visible",
        timeout: 15_000,
      })
    );
    console.log("Home archived projects section verified");

    await window.getByRole("button", { name: `Open project ${projectNameValue}` }).click();
    await withTimeout("canvas route from home card", window.waitForURL(projectRoutePattern(projectId, "canvas")));
    console.log("Home project card navigation verified");

    if (runtime.triggerNativeMenuItem) {
      await runtime.triggerNativeMenuItem("project.home");
      await withTimeout("native menu home route", window.waitForURL(appHomeRoutePattern()));
      await withTimeout(
        "native menu home heading",
        window.getByRole("heading", { name: "App Home" }).waitFor({ state: "visible", timeout: 15_000 })
      );
      console.log("Native Project > Home navigation verified");

      await window.getByRole("button", { name: `Open project ${projectNameValue}` }).click();
      await withTimeout("canvas route after native home", window.waitForURL(projectRoutePattern(projectId, "canvas")));
    }

    if (runtime.triggerNativeMenuItem) {
      await runtime.triggerNativeMenuItem("app.settings");
    } else {
      await openMenuItem(window, "App Settings");
    }
    await withTimeout("app settings route from menu", window.waitForURL(appSettingsRoutePattern()));
    await withTimeout(
      "app settings heading from menu",
      window.getByRole("heading", { name: "App Settings" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await withTimeout(
      "provider credentials heading in app settings",
      window.getByRole("heading", { name: "Provider Credentials" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    await window.screenshot({ path: appSettingsScreenshotPath, fullPage: true });
    console.log("App settings screenshot:", appSettingsScreenshotPath);

    await access(path.join(appDataRoot, "app.sqlite"));
    const storedAssetFiles = await readdir(path.join(appDataRoot, "assets", projectId));
    assert.ok(storedAssetFiles.length > 0, "Expected imported asset files on disk.");
    console.log("On-disk asset storage verified");

    console.log(
      JSON.stringify(
        {
          runtimeMode,
          launchTarget,
          projectId,
          appDataRoot,
          appMetadata,
          canvasScreenshotPath,
          modelPreviewScreenshotPath,
          modelFullScreenshotPath,
          templateFullScreenshotPath,
          listFullScreenshotPath,
          resizedAssetScreenshotPath,
          assetsScreenshotPath,
          queueScreenshotPath,
          projectSettingsScreenshotPath,
          appSettingsScreenshotPath,
          providerSummary,
          nodeLabels,
          assetCount,
          storedAssetFiles,
        },
        null,
        2
      )
    );
  } catch (error) {
    await captureFailureState(window, appDataRoot);
    throw error;
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
