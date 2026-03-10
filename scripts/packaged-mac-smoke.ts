import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import asar from "@electron/asar";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const execFile = promisify(execFileCallback);
const APP_NAME = "Nodes Nodes Nodes";
const APP_ID = "com.rustymeadows.nodesnodenodes";
const FILTERS = {
  type: "all" as const,
  ratingAtLeast: 0,
  flaggedOnly: false,
  tag: "",
  providerId: "all" as const,
  sort: "newest" as const,
};

async function readPackageVersion() {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version?: string };
  return pkg.version || "0.0.0";
}

async function readInfoPlist(infoPlistPath: string) {
  const { stdout } = await execFile("plutil", ["-convert", "json", "-o", "-", infoPlistPath]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function readFileDescription(targetPath: string) {
  const { stdout } = await execFile("file", [targetPath]);
  return stdout.trim();
}

async function saveScreenshot(driver: WebDriver, outputPath: string) {
  const screenshot = await driver.takeScreenshot();
  await writeFile(outputPath, screenshot, "base64");
}

async function waitForUrl(driver: WebDriver, pattern: RegExp, timeoutMs = 15_000) {
  await driver.wait(async () => pattern.test(await driver.getCurrentUrl()), timeoutMs);
}

async function clickButton(driver: WebDriver, label: string) {
  const button = await driver.wait(
    until.elementLocated(By.xpath(`//button[normalize-space()='${label}']`)),
    15_000
  );
  await driver.wait(until.elementIsVisible(button), 15_000);
  await button.click();
}

async function clickButtonContaining(driver: WebDriver, labelFragment: string) {
  const button = await driver.wait(
    until.elementLocated(By.xpath(`//button[contains(normalize-space(.), '${labelFragment}')]`)),
    15_000
  );
  await driver.wait(until.elementIsVisible(button), 15_000);
  await button.click();
}

async function waitForHeading(driver: WebDriver, label: string) {
  const heading = await driver.wait(
    until.elementLocated(By.xpath(`//*[self::h1 or self::h2][normalize-space()='${label}']`)),
    15_000
  );
  await driver.wait(until.elementIsVisible(heading), 15_000);
}

async function main() {
  const version = await readPackageVersion();
  const appDataRoot = await mkdtemp(path.join(os.tmpdir(), "node-interface-packaged-smoke-"));
  const appPath = path.resolve("release", "mac-arm64", `${APP_NAME}.app`);
  const executablePath = path.join(appPath, "Contents", "MacOS", APP_NAME);
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  const iconPath = path.join(appPath, "Contents", "Resources", "icon.icns");
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const unpackedBetterSqlitePath = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  const unpackedKeytarPath = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "keytar",
    "build",
    "Release",
    "keytar.node"
  );
  const zipPath = path.resolve("release", `${APP_NAME}-${version}-arm64-mac.zip`);
  const blockmapPath = `${zipPath}.blockmap`;
  const canvasScreenshotPath = path.join(appDataRoot, "packaged-canvas-smoke.png");
  const nodeFocusScreenshotPath = path.join(appDataRoot, "packaged-node-focus.png");
  const modelFullScreenshotPath = path.join(appDataRoot, "packaged-model-full.png");
  const listFullScreenshotPath = path.join(appDataRoot, "packaged-list-full.png");
  const templateFullScreenshotPath = path.join(appDataRoot, "packaged-template-full.png");
  const nodeLibraryScreenshotPath = path.join(appDataRoot, "packaged-node-library.png");
  const nodeLibraryModelScreenshotPath = path.join(appDataRoot, "packaged-node-library-model.png");
  const nodeLibraryListScreenshotPath = path.join(appDataRoot, "packaged-node-library-list.png");
  const assetsScreenshotPath = path.join(appDataRoot, "packaged-assets-smoke.png");
  const queueScreenshotPath = path.join(appDataRoot, "packaged-queue-smoke.png");
  const projectSettingsScreenshotPath = path.join(appDataRoot, "packaged-project-settings-smoke.png");
  const appSettingsScreenshotPath = path.join(appDataRoot, "packaged-app-settings-smoke.png");

  await Promise.all([
    access(appPath),
    access(executablePath),
    access(infoPlistPath),
    access(iconPath),
    access(appAsarPath),
    access(unpackedBetterSqlitePath),
    access(unpackedKeytarPath),
    access(zipPath),
    access(blockmapPath),
  ]);

  const infoPlist = await readInfoPlist(infoPlistPath);
  assert.equal(infoPlist.CFBundleDisplayName, APP_NAME, "Expected branded app display name.");
  assert.equal(infoPlist.CFBundleName, APP_NAME, "Expected branded bundle name.");
  assert.equal(infoPlist.CFBundleExecutable, APP_NAME, "Expected branded executable name.");
  assert.equal(infoPlist.CFBundleIdentifier, APP_ID, "Expected branded app identifier.");
  assert.equal(infoPlist.CFBundleIconFile, "icon.icns", "Expected packaged icon.");

  const executableDescription = await readFileDescription(executablePath);
  assert.match(executableDescription, /arm64/, "Expected arm64 executable.");

  const asarEntries = asar.listPackage(appAsarPath, { isPack: false });
  const requiredEntries = [
    "/dist/electron/main.cjs",
    "/dist/electron/preload.cjs",
    "/dist/electron/worker.cjs",
    "/dist/renderer/index.html",
    "/package.json",
  ];

  for (const entry of requiredEntries) {
    assert.ok(asarEntries.includes(entry), `Expected ${entry} inside app.asar.`);
  }

  process.env.NODE_ENV = "production";
  process.env.NODE_INTERFACE_APP_DATA = appDataRoot;

  const service = new chrome.ServiceBuilder(path.resolve("node_modules", "electron-chromedriver", "bin", "chromedriver"));
  const options = new chrome.Options().setChromeBinaryPath(executablePath);
  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).setChromeService(service).build();

  try {
    await driver.wait(until.titleIs(APP_NAME), 20_000);

    const providerSummary = await driver.executeScript(async () => {
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

    await waitForHeading(driver, "App Home");
    await clickButton(driver, "App Settings");
    await waitForUrl(driver, /#?\/settings\/app$/);
    await waitForHeading(driver, "App Settings");
    await waitForHeading(driver, "Provider Credentials");
    await clickButton(driver, "Back to Home");
    await waitForHeading(driver, "App Home");

    await clickButton(driver, "Node Library");
    await waitForUrl(driver, /#?\/nodes$/);
    await waitForHeading(driver, "Node Library");
    await saveScreenshot(driver, nodeLibraryScreenshotPath);

    await clickButtonContaining(driver, "Model Node");
    await waitForUrl(driver, /#?\/nodes\/model$/);
    await waitForHeading(driver, "Model Node");
    await saveScreenshot(driver, nodeLibraryModelScreenshotPath);

    await clickButton(driver, "Node Library");
    await waitForUrl(driver, /#?\/nodes$/);
    await clickButtonContaining(driver, "List / Sheet");
    await waitForUrl(driver, /#?\/nodes\/list$/);
    await waitForHeading(driver, "List / Sheet");
    await saveScreenshot(driver, nodeLibraryListScreenshotPath);

    await clickButton(driver, "Home");
    await waitForHeading(driver, "App Home");
    await clickButton(driver, "Create Project");
    await waitForUrl(driver, /#\/projects\/[^/]+\/canvas$/);

    const projectId = await driver.executeScript(() => {
      const currentUrl = `${window.location.pathname}${window.location.hash}`;
      return currentUrl.match(/\/projects\/([^/]+)/)?.[1] || "";
    });
    assert.ok(projectId, "Expected a project id in the canvas route.");

    const nodeLabels = await driver.executeScript(async ({ activeProjectId }) => {
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

    await driver.navigate().refresh();
    await sleep(800);
    await saveScreenshot(driver, canvasScreenshotPath);
    await driver.wait(
      async () =>
        Boolean(
          await driver.executeScript(() => {
            return Boolean(
              (window as typeof window & {
                __NND_CANVAS_TEST__?: unknown;
              }).__NND_CANVAS_TEST__
            );
          })
        ),
      15_000
    );

    const viewportBeforeNodeFocus = await driver.executeScript(() => {
      return (
        (window as typeof window & {
          __NND_CANVAS_TEST__?: {
            getState: () => {
              activeFullNodeId: string | null;
              canvasViewport: { x: number; y: number; zoom: number };
            };
          };
        }).__NND_CANVAS_TEST__?.getState() || {
          activeFullNodeId: null,
          canvasViewport: { x: 0, y: 0, zoom: 1 },
        }
      );
    });
    await driver.executeScript(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          focusAndOpenNode: (nodeId: string) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.focusAndOpenNode("smoke-text-note");
    });
    await driver.wait(
      async () =>
        Boolean(
          await driver.executeScript((beforeZoom: number) => {
            const api = (window as typeof window & {
              __NND_CANVAS_TEST__?: {
                getState: () => {
                  selectedNodeIds: string[];
                  activeFullNodeId: string | null;
                  canvasViewport: { x: number; y: number; zoom: number };
                };
              };
            }).__NND_CANVAS_TEST__;
            if (!api) {
              return false;
            }

            const state = api.getState();
            return (
              state.selectedNodeIds.length === 1 &&
              state.selectedNodeIds[0] === "smoke-text-note" &&
              state.activeFullNodeId === null &&
              state.canvasViewport.zoom > beforeZoom + 0.02
            );
          }, viewportBeforeNodeFocus.canvasViewport.zoom)
        ),
      15_000
    );
    const viewportAfterNodeFocus = await driver.executeScript(() => {
      return (
        (window as typeof window & {
          __NND_CANVAS_TEST__?: {
            getState: () => {
              selectedNodeIds: string[];
              activeFullNodeId: string | null;
              canvasViewport: { x: number; y: number; zoom: number };
            };
          };
        }).__NND_CANVAS_TEST__?.getState() || {
          selectedNodeIds: [],
          activeFullNodeId: null,
          canvasViewport: { x: 0, y: 0, zoom: 1 },
        }
      );
    });
    assert.deepEqual(viewportAfterNodeFocus.selectedNodeIds, ["smoke-text-note"]);
    assert.equal(viewportAfterNodeFocus.activeFullNodeId, null);
    assert.ok(viewportAfterNodeFocus.canvasViewport.zoom <= 1.1, "Expected packaged node focus zoom to stay gentle.");
    await saveScreenshot(driver, nodeFocusScreenshotPath);

    await driver.executeScript(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          openPrimaryEditor: (nodeId: string) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.openPrimaryEditor("smoke-model-node");
    });
    await sleep(800);
    await saveScreenshot(driver, modelFullScreenshotPath);

    await driver.executeScript(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          openPrimaryEditor: (nodeId: string) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.openPrimaryEditor("smoke-list-node");
    });
    await sleep(800);
    await saveScreenshot(driver, listFullScreenshotPath);

    await driver.executeScript(() => {
      const api = (window as typeof window & {
        __NND_CANVAS_TEST__?: {
          openPrimaryEditor: (nodeId: string) => void;
        };
      }).__NND_CANVAS_TEST__;
      api?.openPrimaryEditor("smoke-template-node");
    });
    await sleep(800);
    await saveScreenshot(driver, templateFullScreenshotPath);

    const importedAssets = await driver.executeScript(async ({ activeProjectId }) => {
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

    const assetCount = await driver.executeScript(
      async ({ activeProjectId, filters }) => (await window.nodeInterface.listAssets(activeProjectId, filters)).length,
      { activeProjectId: projectId, filters: FILTERS }
    );
    assert.equal(assetCount, 1, "Expected one asset after import.");

    await clickButton(driver, "Menu");
    await clickButton(driver, "Assets");
    await waitForUrl(driver, new RegExp(`#?/projects/${projectId}/assets$`));
    await driver.wait(
      until.elementLocated(By.css(`img[alt='Generated asset ${importedAssets[0]!.id}']`)),
      15_000
    );
    await sleep(800);
    await saveScreenshot(driver, assetsScreenshotPath);

    await clickButton(driver, "Menu");
    await clickButton(driver, "Queue");
    await waitForUrl(driver, new RegExp(`#?/projects/${projectId}/queue$`));
    await waitForHeading(driver, "Queue");
    await waitForHeading(driver, "Call Inspector");
    await saveScreenshot(driver, queueScreenshotPath);

    await clickButton(driver, "Menu");
    await clickButton(driver, "Project Settings");
    await waitForUrl(driver, new RegExp(`#?/projects/${projectId}/settings$`));
    await waitForHeading(driver, "Project Settings");
    const visibleInputs = await driver.findElements(By.css("input"));
    let projectNameValue = "";
    for (const input of visibleInputs) {
      if (await input.isDisplayed()) {
        projectNameValue = await input.getAttribute("value");
        break;
      }
    }
    assert.ok(projectNameValue.trim().length > 0, "Expected a project name in settings.");
    const settingsText = await driver.findElement(By.css("body")).getText();
    assert.ok(!settingsText.includes("Provider Credentials"), "Project settings should not include provider credentials.");
    await saveScreenshot(driver, projectSettingsScreenshotPath);

    await clickButton(driver, "Menu");
    await clickButton(driver, "App Settings");
    await waitForUrl(driver, /#?\/settings\/app$/);
    await waitForHeading(driver, "App Settings");
    await waitForHeading(driver, "Provider Credentials");
    await saveScreenshot(driver, appSettingsScreenshotPath);

    await access(path.join(appDataRoot, "app.sqlite"));
    const storedAssetFiles = await readdir(path.join(appDataRoot, "assets", projectId));
    assert.ok(storedAssetFiles.length > 0, "Expected imported asset files on disk.");

    console.log(
      JSON.stringify(
        {
          appPath,
          executablePath,
          zipPath,
          blockmapPath,
          appDataRoot,
          infoPlist: {
            CFBundleDisplayName: infoPlist.CFBundleDisplayName,
            CFBundleName: infoPlist.CFBundleName,
            CFBundleExecutable: infoPlist.CFBundleExecutable,
            CFBundleIdentifier: infoPlist.CFBundleIdentifier,
            CFBundleIconFile: infoPlist.CFBundleIconFile,
          },
          executableDescription,
          providerSummary,
          projectId,
          nodeLabels,
          assetCount,
          storedAssetFiles,
          canvasScreenshotPath,
          nodeFocusScreenshotPath,
          modelFullScreenshotPath,
          listFullScreenshotPath,
          templateFullScreenshotPath,
          nodeLibraryScreenshotPath,
          nodeLibraryModelScreenshotPath,
          nodeLibraryListScreenshotPath,
          assetsScreenshotPath,
          queueScreenshotPath,
          projectSettingsScreenshotPath,
          appSettingsScreenshotPath,
          unpackedNativeModules: [unpackedBetterSqlitePath, unpackedKeytarPath],
        },
        null,
        2
      )
    );
  } finally {
    await driver.quit();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
