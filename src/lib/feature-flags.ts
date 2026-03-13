import type { AppFeatureFlags, AppFeatureFlagKey } from "@/components/workspace/types";

export const APP_FEATURE_FLAG_DEFAULTS: AppFeatureFlags = {
  capturePng: true,
  canvasNodeCleanup: true,
};

export const APP_FEATURE_FLAG_KEYS = Object.keys(APP_FEATURE_FLAG_DEFAULTS) as AppFeatureFlagKey[];

export function normalizeFeatureFlags(value: unknown): AppFeatureFlags {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    capturePng: typeof source.capturePng === "boolean" ? source.capturePng : APP_FEATURE_FLAG_DEFAULTS.capturePng,
    canvasNodeCleanup:
      typeof source.canvasNodeCleanup === "boolean"
        ? source.canvasNodeCleanup
        : APP_FEATURE_FLAG_DEFAULTS.canvasNodeCleanup,
  };
}

