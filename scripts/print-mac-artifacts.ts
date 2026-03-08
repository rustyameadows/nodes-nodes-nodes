import { access, readFile } from "node:fs/promises";
import path from "node:path";

const APP_NAME = "Nodes Nodes Nodes";

async function readPackageVersion() {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version?: string };
  return pkg.version || "0.0.0";
}

async function main() {
  const version = await readPackageVersion();
  const appPath = path.resolve("release", "mac-arm64", `${APP_NAME}.app`);
  const executablePath = path.join(appPath, "Contents", "MacOS", APP_NAME);
  const zipPath = path.resolve("release", `${APP_NAME}-${version}-arm64-mac.zip`);

  await access(appPath);
  await access(executablePath);
  await access(zipPath);

  console.log(
    JSON.stringify(
      {
        appPath,
        executablePath,
        zipPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
