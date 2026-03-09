import { mkdirSync } from "node:fs";
import path from "node:path";

function ensureDir(dirPath: string) {
  mkdirSync(dirPath, { recursive: true });
}

export function getAppDataRoot() {
  const root = process.env.NODE_INTERFACE_APP_DATA || path.join(process.cwd(), ".local-desktop");
  ensureDir(root);
  return root;
}

export function getDatabaseFilePath() {
  return path.join(getAppDataRoot(), "app.sqlite");
}

export function getAssetsRoot() {
  const assetsRoot = path.join(getAppDataRoot(), "assets");
  ensureDir(assetsRoot);
  return assetsRoot;
}

export function getPreviewsRoot() {
  const previewsRoot = path.join(getAppDataRoot(), "previews");
  ensureDir(previewsRoot);
  return previewsRoot;
}

export function getProjectAssetsRoot(projectId: string) {
  const projectRoot = path.join(getAssetsRoot(), projectId);
  ensureDir(projectRoot);
  return projectRoot;
}

export function getJobPreviewRoot(jobId: string) {
  const jobRoot = path.join(getPreviewsRoot(), jobId);
  ensureDir(jobRoot);
  return jobRoot;
}
