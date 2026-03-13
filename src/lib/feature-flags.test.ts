import assert from "node:assert/strict";
import test from "node:test";
import { APP_FEATURE_FLAG_DEFAULTS, normalizeFeatureFlags } from "@/lib/feature-flags";

test("normalizeFeatureFlags falls back to defaults", () => {
  assert.deepEqual(normalizeFeatureFlags(undefined), APP_FEATURE_FLAG_DEFAULTS);
  assert.deepEqual(normalizeFeatureFlags({}), APP_FEATURE_FLAG_DEFAULTS);
});

test("normalizeFeatureFlags keeps explicit boolean values", () => {
  assert.deepEqual(
    normalizeFeatureFlags({
      capturePng: false,
      canvasNodeCleanup: true,
    }),
    {
      capturePng: false,
      canvasNodeCleanup: true,
    }
  );
});
