import type { CanvasAccentType } from "@/components/canvas-node-types";

export const canvasNodeAccentTokens = {
  neutral: {
    color: "rgba(255, 255, 255, 0.9)",
    glow: "rgba(255, 255, 255, 0.26)",
  },
  text: {
    color: "#ff4dc4",
    glow: "rgba(255, 77, 196, 0.5)",
  },
  image: {
    color: "#3ea4ff",
    glow: "rgba(62, 164, 255, 0.48)",
  },
  video: {
    color: "#ff8d34",
    glow: "rgba(255, 141, 52, 0.46)",
  },
  function: {
    color: "#9b4dff",
    glow: "rgba(155, 77, 255, 0.48)",
  },
  citrus: {
    color: "#d8ff3e",
    glow: "rgba(216, 255, 62, 0.52)",
  },
} satisfies Record<CanvasAccentType, { color: string; glow: string }>;

export const canvasNodeSurfaceTokens = {
  paper: "rgba(255, 255, 255, 0.985)",
  paperMuted: "rgba(246, 246, 244, 0.985)",
  paperRaised: "rgba(255, 255, 255, 0.94)",
  ink: "rgba(0, 0, 0, 0.94)",
  inkSoft: "rgba(0, 0, 0, 0.76)",
  inkMuted: "rgba(0, 0, 0, 0.56)",
  borderSoft: "rgba(0, 0, 0, 0.12)",
  borderStrong: "rgba(0, 0, 0, 0.18)",
  checkerLight: "rgba(255, 255, 255, 0.88)",
  checkerDark: "rgba(231, 231, 231, 0.84)",
  checkerGrid: "rgba(0, 0, 0, 0.08)",
  railShadow: "0 12px 26px rgba(0, 0, 0, 0.28)",
  cardShadow: "0 10px 18px rgba(0, 0, 0, 0.2)",
  hotspotHover: "rgba(255, 255, 255, 0.24)",
} as const;
