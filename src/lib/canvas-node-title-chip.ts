import type { CanvasAccentType, CanvasRenderNode } from "@/components/canvas-node-types";
import { getCanvasNodeAccentColor } from "@/lib/canvas-node-design-system";

export type CanvasNodeTitleChip = {
  label: string;
  accentType: CanvasAccentType;
  color: string;
};

type Input = Pick<CanvasRenderNode, "kind" | "assetOrigin" | "outputType" | "displayModelName" | "modelId">;

function getAssetAccentType(outputType: Input["outputType"]): CanvasAccentType {
  if (outputType === "video") {
    return "video";
  }

  if (outputType === "text") {
    return "text";
  }

  return "image";
}

export function getCanvasNodeTitleChip(node: Input): CanvasNodeTitleChip {
  if (node.kind === "model") {
    const label = node.displayModelName?.trim() || node.modelId?.trim() || "Model";
    return {
      label,
      accentType: "citrus",
      color: getCanvasNodeAccentColor("citrus"),
    };
  }

  if (node.kind === "text-note") {
    return {
      label: "Text Note",
      accentType: "text",
      color: getCanvasNodeAccentColor("text"),
    };
  }

  if (node.kind === "reference") {
    return {
      label: "Reference",
      accentType: "operator",
      color: getCanvasNodeAccentColor("operator"),
    };
  }

  if (node.kind === "list") {
    return {
      label: "List / Sheet",
      accentType: "text",
      color: getCanvasNodeAccentColor("text"),
    };
  }

  if (node.kind === "text-template") {
    return {
      label: "Template Node",
      accentType: "operator",
      color: getCanvasNodeAccentColor("operator"),
    };
  }

  const accentType = getAssetAccentType(node.outputType);
  return {
    label: node.assetOrigin === "generated" ? "Generated Asset" : "Uploaded Asset",
    accentType,
    color: getCanvasNodeAccentColor(accentType),
  };
}
