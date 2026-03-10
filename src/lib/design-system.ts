import type {
  UiBadgeVariant,
  UiButtonSize,
  UiButtonVariant,
  UiDensity,
  UiPanelVariant,
  UiSurface,
} from "@/styles/design-system/contracts";
import {
  defaultUiDensity,
  defaultUiSurface,
  designSystemTokenVariables,
  tokenPathToCssVariableName,
} from "@/styles/design-system/tokens";

export type UiDataAttributes = {
  "data-ui-surface"?: UiSurface;
  "data-ui-density"?: UiDensity;
};

export function buildUiDataAttributes(surface?: UiSurface, density?: UiDensity): UiDataAttributes {
  const attrs: UiDataAttributes = {};

  if (surface) {
    attrs["data-ui-surface"] = surface;
  }

  if (density) {
    attrs["data-ui-density"] = density;
  }

  return attrs;
}

export function normalizeUiSurface(surface?: UiSurface) {
  return surface || defaultUiSurface;
}

export function normalizeUiDensity(density?: UiDensity) {
  return density || defaultUiDensity;
}

export function resolveButtonVariant(variant?: UiButtonVariant) {
  return variant || "secondary";
}

export function resolveButtonSize(size?: UiButtonSize) {
  return size || "md";
}

export function resolvePanelVariant(variant?: UiPanelVariant) {
  return variant || "panel";
}

export function resolveBadgeVariant(variant?: UiBadgeVariant) {
  return variant || "neutral";
}

export function getDesignSystemTokenVariableNames() {
  return [
    ...designSystemTokenVariables.primitive.map((entry) => entry.cssVariableName),
    ...designSystemTokenVariables.semantic.map((entry) => entry.cssVariableName),
    ...designSystemTokenVariables.component.map((entry) => entry.cssVariableName),
  ];
}

export const designSystemGuardrailScopes = [
  "src/components/ui/",
  "src/components/canvas-nodes/",
  "src/components/workspace/workspace-shell",
  "src/components/searchable-model-select",
  "src/components/workspace/views/app-home-view",
  "src/components/workspace/views/assets-view",
  "src/components/workspace/views/asset-detail-view",
  "src/components/workspace/views/queue-view",
  "src/components/workspace/views/settings-view",
  "src/components/workspace/views/node-library-view",
  "src/components/workspace/views/node-library-detail-view",
  "src/components/workspace/views/canvas-view",
  "src/components/workspace/views/canvas-bottom-bar",
] as const;

export const rawColorLiteralPattern =
  /#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|color\(display-p3[^)]*\)/g;

export function tokenVar(path: string[]) {
  return tokenPathToCssVariableName(path);
}

export function isDesignSystemGuardrailFile(filePath: string) {
  return designSystemGuardrailScopes.some((scope) => filePath.includes(scope));
}

export function stripCssVariableDefinitions(content: string) {
  return content.replace(/--(?:ds|node)-[\w-]+\s*:\s*[^;]+;/g, "");
}

export function findForbiddenColorLiterals(content: string) {
  const stripped = stripCssVariableDefinitions(content);
  return stripped.match(rawColorLiteralPattern) || [];
}
