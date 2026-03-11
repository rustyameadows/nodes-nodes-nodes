import type {
  CanvasAccentType,
  CanvasNodeGeneratedProvenance,
} from "@/components/canvas-node-types";
import type { WorkflowNode } from "@/components/workspace/types";
import { canvasNodeAccentTokens } from "@/styles/design-system/nodes/tokens";

export type CanvasNodeBorderLayers = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

export type CanvasNodeBorderSemantics = {
  leftAccentTypes: CanvasAccentType[];
  fallbackLeftAccentType: CanvasAccentType;
  rightAccentType: CanvasAccentType;
  isGeneratedOutput: boolean;
  shouldShowProcessingShimmer: boolean;
};

type ResolveCanvasNodeBorderSemanticsInput = {
  kind: WorkflowNode["kind"];
  assetOrigin?: "generated" | "uploaded" | null;
  outputAccentType: CanvasAccentType;
  inputAccentTypes?: CanvasAccentType[] | null;
  generatedProvenance?: CanvasNodeGeneratedProvenance | null;
  processingState?: WorkflowNode["processingState"];
  hasConnectedOutput?: boolean;
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

function uniqueAccentTypes(types: CanvasAccentType[] | null | undefined) {
  return (types || []).filter((type, index, values) => values.indexOf(type) === index);
}

function getGeneratedProvenanceAccent(provenance: CanvasNodeGeneratedProvenance | null | undefined) {
  if (provenance === "model") {
    return "citrus" as const;
  }
  if (provenance === "operator") {
    return "operator" as const;
  }
  return null;
}

export function resolveCanvasNodeBorderSemantics(
  input: ResolveCanvasNodeBorderSemanticsInput
): CanvasNodeBorderSemantics {
  const cleanInputAccentTypes = uniqueAccentTypes((input.inputAccentTypes || []).filter((type) => type !== "failed"));
  const provenanceAccent = getGeneratedProvenanceAccent(input.generatedProvenance);
  const leftAccentTypes = provenanceAccent
    ? [provenanceAccent, ...cleanInputAccentTypes.filter((type) => type !== provenanceAccent)]
    : cleanInputAccentTypes;
  const isGeneratedOutput = Boolean(provenanceAccent || input.assetOrigin === "generated");
  const isProcessing = input.processingState === "queued" || input.processingState === "running";
  let rightAccentType: CanvasAccentType;

  if (input.processingState === "failed") {
    rightAccentType = "failed";
  } else if (input.kind === "model") {
    rightAccentType = input.hasConnectedOutput ? "citrus" : "neutral";
  } else if (input.kind === "text-template") {
    rightAccentType = provenanceAccent ? "operator" : input.hasConnectedOutput ? "operator" : "neutral";
  } else {
    rightAccentType = input.outputAccentType;
  }

  let fallbackLeftAccentType: CanvasAccentType = "neutral";
  if (provenanceAccent) {
    fallbackLeftAccentType = provenanceAccent;
  } else if (input.kind === "text-note" || input.kind === "list") {
    fallbackLeftAccentType = input.outputAccentType;
  } else if (input.kind === "asset-source" && input.assetOrigin === "uploaded") {
    fallbackLeftAccentType = input.outputAccentType;
  } else if (input.kind === "asset-source" && input.assetOrigin === "generated") {
    fallbackLeftAccentType = "citrus";
  }

  return {
    leftAccentTypes,
    fallbackLeftAccentType,
    rightAccentType,
    isGeneratedOutput,
    shouldShowProcessingShimmer: isGeneratedOutput && isProcessing,
  };
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
