import assert from "node:assert/strict";
import test from "node:test";
import type { NodeCatalogVariant } from "./node-catalog";
import {
  filterModelVariants,
  getInitialActiveModelVariantId,
  getNextActiveModelVariantId,
  groupModelVariants,
} from "./model-variant-select";

const variants: NodeCatalogVariant[] = [
  {
    id: "model:openai:gpt-5-mini",
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-5-mini",
    label: "GPT 5 Mini",
    description: "Fast image generation",
    availabilityLabel: "Ready",
    status: "ready",
    disabled: false,
    disabledReason: null,
  },
  {
    id: "model:openai:gpt-image-1.5",
    providerId: "openai",
    providerLabel: "OpenAI",
    modelId: "gpt-image-1.5",
    label: "GPT Image 1.5",
    description: "Image model",
    availabilityLabel: "Ready",
    status: "ready",
    disabled: false,
    disabledReason: null,
  },
  {
    id: "model:google-gemini:gemini-3-flash-preview",
    providerId: "google-gemini",
    providerLabel: "Google Gemini",
    modelId: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    description: "Preview image/text model",
    availabilityLabel: "Requires paid tier",
    status: "unavailable",
    disabled: true,
    disabledReason: "Requires paid tier",
  },
];

test("filterModelVariants searches provider, label, model id, and availability copy", () => {
  assert.deepEqual(
    filterModelVariants(variants, "paid").map((variant) => variant.id),
    ["model:google-gemini:gemini-3-flash-preview"]
  );
  assert.deepEqual(
    filterModelVariants(variants, "gpt").map((variant) => variant.id),
    ["model:openai:gpt-5-mini", "model:openai:gpt-image-1.5"]
  );
});

test("groupModelVariants preserves provider order", () => {
  assert.deepEqual(
    groupModelVariants(variants).map((group) => [group.providerLabel, group.options.length]),
    [
      ["OpenAI", 2],
      ["Google Gemini", 1],
    ]
  );
});

test("active model variant navigation skips disabled options", () => {
  assert.equal(getInitialActiveModelVariantId(variants, "model:google-gemini:gemini-3-flash-preview"), "model:openai:gpt-5-mini");
  assert.equal(getNextActiveModelVariantId(variants, "model:openai:gpt-5-mini", 1), "model:openai:gpt-image-1.5");
  assert.equal(getNextActiveModelVariantId(variants, "model:openai:gpt-image-1.5", 1), "model:openai:gpt-5-mini");
});
