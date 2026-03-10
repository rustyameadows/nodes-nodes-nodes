import path from "node:path";
import { existsSync } from "node:fs";
import { nativeImage } from "electron";

function loadBrandedAppIcon() {
  const candidatePaths = [
    path.join(process.resourcesPath, "icon.icns"),
    path.resolve(__dirname, "../../build-resources/icon.png"),
    path.resolve(process.cwd(), "build-resources/icon.png"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    const image = nativeImage.createFromPath(candidatePath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return null;
}

export function createAppIcon() {
  const branded = loadBrandedAppIcon();
  if (branded) {
    return branded;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="0" fill="#ff4fa2" />
    </svg>
  `.trim();

  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

export function createMenuBarIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="18" viewBox="0 0 22 18">
      <rect x="3" y="3" width="16" height="2.4" rx="1.2" fill="#000000" />
      <rect x="3" y="7.8" width="16" height="2.4" rx="1.2" fill="#000000" />
      <rect x="3" y="12.6" width="11.5" height="2.4" rx="1.2" fill="#000000" />
    </svg>
  `.trim();

  const image = nativeImage
    .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    .resize({ height: 18 });
  image.setTemplateImage(true);
  return image;
}
