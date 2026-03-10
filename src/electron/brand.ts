import { nativeImage } from "electron";

export function createAppIcon() {
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
