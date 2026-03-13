import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderModel } from "@/components/workspace/types";
import {
  getInsertableNodeCatalogEntries,
  getModelCatalogVariants,
  getNodeCatalogEntry,
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
      billingAvailability: "free_and_paid",
      accessStatus: "available",
      accessReason: null,
      accessMessage: null,
      lastCheckedAt: null,
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
      billingAvailability: "free_and_paid",
      accessStatus: "available",
      accessReason: null,
      accessMessage: null,
      lastCheckedAt: null,
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
      billingAvailability: "free_and_paid",
      accessStatus: "blocked",
      accessReason: "missing_key",
      accessMessage: "Save TOPAZ_API_KEY in Settings or set it in .env.local and restart the app.",
      lastCheckedAt: null,
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
    ["model", "text-note", "reference", "list", "text-template", "asset-uploaded", "asset-generated"]
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

test("model catalog variants surface Gemini access states and paid-tier labels", () => {
  const variants = getModelCatalogVariants([
    createProviderModel({
      providerId: "google-gemini",
      modelId: "gemini-2.5-flash-image",
      displayName: "Nano Banana",
      capabilities: {
        text: false,
        image: true,
        video: false,
        runnable: false,
        availability: "ready",
        billingAvailability: "paid_only",
        accessStatus: "blocked",
        accessReason: "not_listed",
        accessMessage: "Requires a paid Gemini API project.",
        lastCheckedAt: "2026-03-09T00:00:00.000Z",
        requiresApiKeyEnv: "GOOGLE_API_KEY",
        apiKeyConfigured: true,
        requirements: [],
        promptMode: "required",
        executionModes: ["generate", "edit"],
        acceptedInputMimeTypes: [],
        maxInputImages: 0,
        parameters: [],
        defaults: {},
      },
    }),
    createProviderModel({
      providerId: "google-gemini",
      modelId: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      capabilities: {
        text: true,
        image: false,
        video: false,
        runnable: true,
        availability: "ready",
        billingAvailability: "free_and_paid",
        accessStatus: "unknown",
        accessReason: "probe_failed",
        accessMessage: "Gemini model access could not be verified. Try refreshing access.",
        lastCheckedAt: "2026-03-09T00:00:00.000Z",
        requiresApiKeyEnv: "GOOGLE_API_KEY",
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
      providerId: "google-gemini",
      modelId: "gemini-3-flash-preview",
      displayName: "Gemini 3 Flash",
      capabilities: {
        text: true,
        image: false,
        video: false,
        runnable: true,
        availability: "ready",
        billingAvailability: "free_and_paid",
        accessStatus: "limited",
        accessReason: "rate_limited",
        accessMessage: "This Gemini project is currently rate limited.",
        lastCheckedAt: "2026-03-09T00:00:00.000Z",
        requiresApiKeyEnv: "GOOGLE_API_KEY",
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
  ]);

  assert.equal(variants[0]?.availabilityLabel, "Requires paid tier");
  assert.equal(variants[0]?.disabled, true);
  assert.equal(variants[1]?.status, "unverified");
  assert.equal(variants[1]?.disabled, false);
  assert.equal(variants[2]?.status, "temporarily_limited");
  assert.equal(variants[2]?.disabled, false);
});

test("insertable catalog entries respect canvas insertion context", () => {
  assert.deepEqual(
    getInsertableNodeCatalogEntries("canvas", sampleProviders).map((entry) => entry.id),
    ["model", "text-note", "reference", "list", "text-template", "asset-uploaded", "asset-generated"]
  );
  assert.deepEqual(
    getInsertableNodeCatalogEntries("model-input", sampleProviders).map((entry) => entry.id),
    ["text-note", "reference", "asset-uploaded", "asset-generated"]
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

test("model playground fixture is self-contained and no longer boots from a forced focus node", () => {
  const modelEntry = getNodeCatalogEntry("model", sampleProviders);

  assert.ok(modelEntry);
  const fixture = modelEntry.buildPlaygroundFixture(sampleProviders);
  assert.equal("focusNodeId" in fixture, false);
  assert.equal(fixture.primaryNodeId, "library-model-primary");
  assert.deepEqual(fixture.resizePresetSize, { width: 640, height: 420 });
  assert.equal(fixture.nodes.length, 1);
  assert.equal(fixture.nodes[0]?.kind, "model");
  assert.equal(fixture.nodes[0]?.promptSourceNodeId, null);
  assert.ok(fixture.nodes[0]?.prompt.length);
  assert.deepEqual(modelEntry.supportedDisplayModes, ["preview", "compact", "full", "resized"]);
});

test("generated asset playground fixture preserves source-model lineage", () => {
  const generatedAssetEntry = getNodeCatalogEntry("asset-generated", sampleProviders);

  assert.ok(generatedAssetEntry);
  const fixture = generatedAssetEntry.buildPlaygroundFixture(sampleProviders);
  const modelNode = fixture.nodes.find((node) => node.kind === "model");
  const assetNode = fixture.nodes.find((node) => node.kind === "asset-source");

  assert.ok(modelNode);
  assert.ok(assetNode);
  assert.equal(fixture.primaryNodeId, assetNode.id);
  assert.deepEqual(fixture.resizePresetSize, { width: 320, height: 320 });
  assert.deepEqual(assetNode.upstreamNodeIds, [modelNode.id]);
  assert.deepEqual(assetNode.upstreamAssetIds, [`node:${modelNode.id}`]);
  assert.equal(assetNode.sourceAssetId, null);
});
