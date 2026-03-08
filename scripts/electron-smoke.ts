import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, chromium, type Browser, type Page } from "playwright";

const APP_NAME = "Nodes Node Nodes";
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
  itemName: "Assets" | "Queue" | "Project Settings"
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
  const assetsScreenshotPath = path.join(appDataRoot, "assets-smoke.png");
  const queueScreenshotPath = path.join(appDataRoot, "queue-smoke.png");
  const settingsScreenshotPath = path.join(appDataRoot, "settings-smoke.png");
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
        /Nodes Node Nodes\.app\/Contents\/MacOS\/Nodes Node Nodes$/,
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
      "launcher heading",
      window.getByRole("heading", { name: "Start a Project" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    console.log("Launcher rendered");

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
                promptSourceNodeId: "smoke-text-note",
                upstreamNodeIds: [],
                upstreamAssetIds: [],
                x: 420,
                y: 120,
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

    assert.deepEqual(nodeLabels, ["Smoke Prompt", "Smoke Image Model"]);
    console.log("Canvas snapshot round-trip verified");

    await window.reload();
    await withTimeout("canvas reload", window.waitForLoadState("domcontentloaded"));
    await window.waitForTimeout(800);
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
    await withTimeout(
      "provider credentials heading",
      window.getByRole("heading", { name: "Provider Credentials" }).waitFor({ state: "visible", timeout: 15_000 })
    );
    const projectNameValue = await window.getByRole("textbox").first().inputValue();
    assert.ok(projectNameValue.trim().length > 0, "Expected a project name in settings.");
    await window.screenshot({ path: settingsScreenshotPath, fullPage: true });
    console.log("Settings screenshot:", settingsScreenshotPath);

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
          assetsScreenshotPath,
          queueScreenshotPath,
          settingsScreenshotPath,
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
