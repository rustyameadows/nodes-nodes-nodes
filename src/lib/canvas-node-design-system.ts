import type { CanvasAccentType } from "@/components/canvas-node-types";
import { canvasNodeAccentTokens } from "@/styles/design-system/nodes/tokens";

export type CanvasNodeBorderLayers = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

export function getCanvasNodeAccentColor(type: CanvasAccentType) {
  return canvasNodeAccentTokens[type].color;
}

export function getCanvasNodeAccentGlow(type: CanvasAccentType) {
  return canvasNodeAccentTokens[type].glow;
}

function mixColor(colorA: string, colorB: string, ratioA = 50) {
  const ratioB = 100 - ratioA;
  return `color-mix(in srgb, ${colorA} ${ratioA}%, ${colorB} ${ratioB}%)`;
}

export function getCanvasNodeBorderLayers(
  leftAccentTypes: CanvasAccentType[],
  rightAccentType: CanvasAccentType,
  fallbackLeftAccentType: CanvasAccentType = "neutral"
): CanvasNodeBorderLayers {
  const uniqueLeftTypes = leftAccentTypes.filter((type, index) => leftAccentTypes.indexOf(type) === index);
  const normalizedLeftTypes: CanvasAccentType[] = uniqueLeftTypes.length > 0 ? uniqueLeftTypes : [fallbackLeftAccentType];
  const topLeft = getCanvasNodeAccentColor(normalizedLeftTypes[0]);
  const bottomLeft = getCanvasNodeAccentColor(normalizedLeftTypes[Math.min(1, normalizedLeftTypes.length - 1)]);
  const right = getCanvasNodeAccentColor(rightAccentType);
  const neutral = getCanvasNodeAccentColor("neutral");
  const rightSide = rightAccentType === "neutral" ? neutral : right;

  if (normalizedLeftTypes.length > 1) {
    return {
      top: `linear-gradient(90deg, ${topLeft} 0%, ${topLeft} 42%, ${mixColor(topLeft, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
      bottom: `linear-gradient(90deg, ${bottomLeft} 0%, ${bottomLeft} 42%, ${mixColor(bottomLeft, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
      left: `linear-gradient(180deg, ${topLeft} 0%, ${topLeft} 42%, ${mixColor(topLeft, bottomLeft, 52)} 50%, ${bottomLeft} 58%, ${bottomLeft} 100%)`,
      right: `linear-gradient(180deg, ${rightSide} 0%, ${rightSide} 100%)`,
    };
  }

  const left = topLeft;
  return {
    top: `linear-gradient(90deg, ${left} 0%, ${left} 42%, ${mixColor(left, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
    bottom: `linear-gradient(90deg, ${left} 0%, ${left} 42%, ${mixColor(left, rightSide, 58)} 50%, ${rightSide} 58%, ${rightSide} 100%)`,
    left: `linear-gradient(180deg, ${left} 0%, ${left} 100%)`,
    right: `linear-gradient(180deg, ${rightSide} 0%, ${rightSide} 100%)`,
  };
}
