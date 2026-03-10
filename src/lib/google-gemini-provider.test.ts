import assert from "node:assert/strict";
import test from "node:test";
import { getProviderAdapter } from "@/lib/providers/registry";

test("registers the Gemini launch catalog with stable model ids", () => {
  const models = getProviderAdapter("google-gemini").getModels();

  assert.deepEqual(
    models.map((model) => model.modelId),
    [
      "gemini-2.5-flash-image",
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]
  );

  const byId = new Map(models.map((model) => [model.modelId, model] as const));
  assert.equal(byId.get("gemini-2.5-flash-image")?.displayName, "Nano Banana");
  assert.equal(byId.get("gemini-3-pro-image-preview")?.displayName, "Nano Banana Pro");
  assert.equal(byId.get("gemini-3.1-flash-image-preview")?.displayName, "Nano Banana 2");
  assert.equal(byId.get("gemini-3-flash-preview")?.displayName, "Gemini 3 Flash");
  assert.equal(byId.get("gemini-2.5-flash-image")?.capabilities.billingAvailability, "paid_only");
  assert.equal(byId.get("gemini-3-pro-image-preview")?.capabilities.billingAvailability, "paid_only");
  assert.equal(byId.get("gemini-3.1-flash-image-preview")?.capabilities.billingAvailability, "paid_only");
  assert.equal(byId.get("gemini-2.5-pro")?.capabilities.billingAvailability, "free_and_paid");
  assert.equal(byId.get("gemini-2.5-flash")?.capabilities.accessStatus, "unknown");
  assert.deepEqual(
    byId.get("gemini-3-flash-preview")?.capabilities.parameters.map((parameter) => parameter.key),
    ["maxOutputTokens", "textOutputTarget", "temperature", "topP", "topK", "thinkingLevel"]
  );
  assert.deepEqual(
    byId.get("gemini-2.5-pro")?.capabilities.parameters.map((parameter) => parameter.key),
    ["maxOutputTokens", "textOutputTarget", "temperature", "topP", "topK", "thinkingBudget"]
  );
  assert.deepEqual(
    byId.get("gemini-3-pro-image-preview")?.capabilities.parameters.map((parameter) => parameter.key),
    ["temperature", "aspectRatio", "imageSize", "maxOutputTokens", "topP", "stopSequences"]
  );
  assert.deepEqual(
    byId.get("gemini-2.5-flash-image")?.capabilities.parameters.map((parameter) => parameter.key),
    ["temperature", "aspectRatio", "maxOutputTokens", "topP", "stopSequences"]
  );
  assert.deepEqual(
    byId.get("gemini-3.1-flash-image-preview")?.capabilities.parameters.map((parameter) => parameter.key),
    ["outputMode", "temperature", "aspectRatio", "imageSize", "thinkingLevel", "maxOutputTokens", "topP", "stopSequences"]
  );
});
