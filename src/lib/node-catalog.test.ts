import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderModel } from "@/components/workspace/types";
import {
  getInsertableNodeCatalogEntries,
  getModelCatalogVariants,
  getNodeCatalogEntries,
  getSpawnableNodeCatalogSummaries,
} from "@/lib/node-catalog";

function createProviderModel(overrides: Partial<ProviderModel>): ProviderModel {
  return {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: true,
      availability: "ready",
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
    ...overrides,
  };
}

const sampleProviders: ProviderModel[] = [
  createProviderModel({
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
  }),
  createProviderModel({
    providerId: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT 5 Mini",
    capabilities: {
      text: true,
      image: false,
      video: false,
      runnable: true,
      availability: "ready",
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: true,
      requirements: [],
      promptMode: "required",
      executionModes: ["generate"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {
        textOutputTarget: "note",
      },
    },
  }),
  createProviderModel({
    providerId: "topaz",
    modelId: "high_fidelity_v2",
    displayName: "High Fidelity v2",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: false,
      availability: "ready",
      requiresApiKeyEnv: "TOPAZ_API_KEY",
      apiKeyConfigured: false,
      requirements: [],
      promptMode: "optional",
      executionModes: ["edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
  }),
];

test("node catalog exposes the built-in library surface", () => {
  const entries = getNodeCatalogEntries(sampleProviders);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["model", "text-note", "list", "text-template", "asset-uploaded", "asset-generated"]
  );
});

test("model catalog variants derive from provider catalog state", () => {
  const variants = getModelCatalogVariants(sampleProviders);

  assert.deepEqual(
    variants.map((variant) => variant.id),
    ["model:openai:gpt-image-1.5", "model:openai:gpt-5-mini", "model:topaz:high_fidelity_v2"]
  );
  assert.equal(variants[2]?.status, "missing_key");
});

test("insertable catalog entries respect canvas insertion context", () => {
  assert.deepEqual(
    getInsertableNodeCatalogEntries("canvas", sampleProviders).map((entry) => entry.id),
    ["model", "text-note", "list", "text-template", "asset-uploaded", "asset-generated"]
  );
  assert.deepEqual(
    getInsertableNodeCatalogEntries("model-input", sampleProviders).map((entry) => entry.id),
    ["text-note", "asset-uploaded", "asset-generated"]
  );
  assert.deepEqual(
    getInsertableNodeCatalogEntries("template-input", sampleProviders).map((entry) => entry.id),
    ["list"]
  );
});

test("spawnable prompt summaries are derived from the node catalog", () => {
  const summaries = getSpawnableNodeCatalogSummaries();

  assert.deepEqual(
    summaries.map((summary) => summary.kind),
    ["text-note", "list", "text-template"]
  );
  assert.ok(summaries.every((summary) => summary.promptSummary.length > 0));
  assert.ok(summaries.every((summary) => summary.payloadSummary.length > 0));
});
