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

test("Gemini 3-family defaults and parameters include thinking level", () => {
  assert.deepEqual(getGeminiTextDefaultSettings("gemini-3-flash-preview"), {
    textOutputTarget: "note",
    thinkingLevel: "high",
  });
  assert.deepEqual(
    getGeminiTextParameterDefinitions("gemini-3-flash-preview").map((definition) => definition.key),
    ["maxOutputTokens", "textOutputTarget", "temperature", "topP", "topK", "thinkingLevel"]
  );
});

test("Gemini 2.5-family defaults and parameters include thinking budget", () => {
  assert.deepEqual(getGeminiTextDefaultSettings("gemini-2.5-pro"), {
    textOutputTarget: "note",
    thinkingBudget: -1,
  });
  assert.deepEqual(
    getGeminiTextParameterDefinitions("gemini-2.5-pro").map((definition) => definition.key),
    ["maxOutputTokens", "textOutputTarget", "temperature", "topP", "topK", "thinkingBudget"]
  );
  assert.deepEqual(getGeminiTextDefaultSettings("gemini-2.5-flash-lite"), {
    textOutputTarget: "note",
    thinkingBudget: 0,
  });
});

test("resolves Gemini 3-family sampling and thinking-level settings", () => {
  const resolved = resolveGeminiTextSettings(
    {
      textOutputTarget: "list",
      maxOutputTokens: 999999,
      temperature: 1.7,
      topP: 0.8,
      topK: 32,
      thinkingLevel: "medium",
      thinkingBudget: 9999,
    },
    "gemini-3-flash-preview"
  );

  assert.equal(resolved.maxOutputTokens, 65536);
  assert.equal(resolved.textOutputTarget, "list");
  assert.equal(resolved.temperature, 1.7);
  assert.equal(resolved.topP, 0.8);
  assert.equal(resolved.topK, 32);
  assert.equal(resolved.thinkingLevel, "medium");
  assert.equal(resolved.thinkingBudget, null);
  assert.equal(resolved.validationError, null);
  assert.deepEqual(resolved.effectiveSettings, {
    textOutputTarget: "list",
    maxOutputTokens: 65536,
    temperature: 1.7,
    topP: 0.8,
    topK: 32,
    thinkingLevel: "medium",
  });
});

test("resolves Gemini 2.5 thinking budgets with model-aware limits", () => {
  const flashLiteResolved = resolveGeminiTextSettings(
    {
      thinkingBudget: 0,
      temperature: 0.5,
    },
    "gemini-2.5-flash-lite"
  );
  assert.equal(flashLiteResolved.thinkingBudget, 0);
  assert.equal(flashLiteResolved.validationError, null);

  const proResolved = resolveGeminiTextSettings(
    {
      thinkingBudget: 0,
    },
    "gemini-2.5-pro"
  );
  assert.equal(proResolved.thinkingBudget, -1);
  assert.equal(proResolved.validationError, "Gemini 2.5 Pro does not support disabling thinking.");

  const flashResolved = resolveGeminiTextSettings(
    {
      thinkingBudget: 999999,
    },
    "gemini-2.5-flash"
  );
  assert.equal(flashResolved.thinkingBudget, -1);
  assert.equal(
    flashResolved.validationError,
    "Thinking Budget must be -1, 0, or a positive integer up to 24576."
  );
});

test("builds structured Gemini config with curated Gemini settings", () => {
  const resolved = resolveGeminiTextSettings(
    {
      textOutputTarget: "template",
      maxOutputTokens: 2048,
      temperature: 0.4,
      topP: 0.9,
      topK: 20,
      thinkingBudget: -1,
    },
    "gemini-2.5-flash"
  );

  const requestConfig = buildGeminiTextRequestConfig(resolved);
  assert.equal(requestConfig.responseMimeType, "application/json");
  assert.equal(typeof requestConfig.systemInstruction, "string");
  assert.equal((requestConfig.responseJsonSchema as { type: string }).type, "object");
  assert.equal(requestConfig.maxOutputTokens, 2048);
  assert.equal(requestConfig.temperature, 0.4);
  assert.equal(requestConfig.topP, 0.9);
  assert.equal(requestConfig.topK, 20);
  assert.deepEqual(requestConfig.thinkingConfig, {
    thinkingBudget: -1,
  });

  const debugRequest = buildGeminiTextDebugRequest({
    modelId: "gemini-2.5-flash",
    prompt: "Return a template.",
    rawSettings: {
      textOutputTarget: "template",
      maxOutputTokens: 2048,
      temperature: 0.4,
      topP: 0.9,
      topK: 20,
      thinkingBudget: -1,
    },
  });

  assert.equal(debugRequest.endpoint, "ai.models.generateContent");
  assert.equal(debugRequest.validationError, null);
  assert.deepEqual(debugRequest.request, {
    model: "gemini-2.5-flash",
    contents: "Return a template.",
    config: requestConfig,
  });
});
