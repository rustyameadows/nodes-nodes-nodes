import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiTextDebugRequest,
  buildGeminiTextRequestConfig,
  getGeminiTextDefaultSettings,
  getGeminiTextParameterDefinitions,
  isRunnableGeminiTextModel,
  resolveGeminiTextSettings,
} from "@/lib/gemini-text-settings";

test("recognizes runnable Gemini text models", () => {
  assert.equal(isRunnableGeminiTextModel("google-gemini", "gemini-3-flash-preview"), true);
  assert.equal(isRunnableGeminiTextModel("google-gemini", "gemini-2.5-flash-image"), false);
  assert.equal(isRunnableGeminiTextModel("openai", "gemini-3-flash-preview"), false);
});

test("exposes Gemini text defaults and minimal parameter surface", () => {
  assert.deepEqual(getGeminiTextDefaultSettings(), {
    maxOutputTokens: null,
    textOutputTarget: "note",
  });
  assert.deepEqual(
    getGeminiTextParameterDefinitions().map((definition) => definition.key),
    ["maxOutputTokens", "textOutputTarget"]
  );
});

test("builds structured Gemini config for non-note targets", () => {
  const resolved = resolveGeminiTextSettings({
    maxOutputTokens: 999999,
    textOutputTarget: "list",
  });

  assert.equal(resolved.maxOutputTokens, 65536);
  assert.equal(resolved.textOutputTarget, "list");
  assert.equal(resolved.validationError, null);

  const requestConfig = buildGeminiTextRequestConfig(resolved);
  assert.equal(requestConfig.responseMimeType, "application/json");
  assert.equal(typeof requestConfig.systemInstruction, "string");
  assert.equal(requestConfig.responseJsonSchema.type, "object");

  const debugRequest = buildGeminiTextDebugRequest({
    modelId: "gemini-3-flash-preview",
    prompt: "Return a city list.",
    rawSettings: {
      textOutputTarget: "list",
      maxOutputTokens: 2048,
    },
  });

  assert.equal(debugRequest.endpoint, "ai.models.generateContent");
  assert.equal(debugRequest.validationError, null);
  assert.deepEqual(debugRequest.request, {
    model: "gemini-3-flash-preview",
    contents: "Return a city list.",
    config: {
      systemInstruction: requestConfig.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: requestConfig.responseJsonSchema,
      maxOutputTokens: 2048,
    },
  });
});
