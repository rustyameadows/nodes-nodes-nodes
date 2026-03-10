import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiImageDebugRequest,
  getGeminiImageDefaultSettings,
  getGeminiImageParameterDefinitions,
  isRunnableGeminiImageModel,
  resolveGeminiImageSettings,
} from "@/lib/gemini-image-settings";

test("recognizes runnable Gemini image models", () => {
  assert.equal(isRunnableGeminiImageModel("google-gemini", "gemini-3-pro-image-preview"), true);
  assert.equal(isRunnableGeminiImageModel("google-gemini", "gemini-2.5-flash"), false);
  assert.equal(isRunnableGeminiImageModel("openai", "gemini-3-pro-image-preview"), false);
});

test("Gemini image model profiles expose curated model-aware controls", () => {
  assert.deepEqual(getGeminiImageDefaultSettings("gemini-2.5-flash-image"), {
    temperature: 1,
    aspectRatio: "auto",
    maxOutputTokens: 32768,
    topP: 0.95,
  });
  assert.deepEqual(
    getGeminiImageParameterDefinitions("gemini-2.5-flash-image").map((definition) => definition.key),
    ["temperature", "aspectRatio", "maxOutputTokens", "topP", "stopSequences"]
  );

  assert.deepEqual(getGeminiImageDefaultSettings("gemini-3-pro-image-preview"), {
    temperature: 1,
    aspectRatio: "auto",
    maxOutputTokens: 32768,
    topP: 0.95,
    imageSize: "1K",
  });
  assert.deepEqual(
    getGeminiImageParameterDefinitions("gemini-3-pro-image-preview").map((definition) => definition.key),
    ["temperature", "aspectRatio", "imageSize", "maxOutputTokens", "topP", "stopSequences"]
  );

  assert.deepEqual(getGeminiImageDefaultSettings("gemini-3.1-flash-image-preview"), {
    outputMode: "images_and_text",
    temperature: 1,
    aspectRatio: "auto",
    maxOutputTokens: 65536,
    topP: 0.95,
    imageSize: "1K",
    thinkingLevel: "minimal",
  });
  assert.deepEqual(
    getGeminiImageParameterDefinitions("gemini-3.1-flash-image-preview").map((definition) => definition.key),
    ["outputMode", "temperature", "aspectRatio", "imageSize", "thinkingLevel", "maxOutputTokens", "topP", "stopSequences"]
  );
});

test("resolves Gemini image settings by model and strips non-Gemini fields", () => {
  const flashImageResolved = resolveGeminiImageSettings(
    {
      outputFormat: "png",
      quality: "auto",
      size: "auto",
      background: "auto",
      moderation: "auto",
      inputFidelity: "high",
      n: 1,
      temperature: 1.1,
      aspectRatio: "16:9",
      imageSize: "4K",
      maxOutputTokens: 32000,
      topP: 0.9,
      stopSequences: "cut\nfade out",
    },
    "gemini-2.5-flash-image"
  );
  assert.equal(flashImageResolved.aspectRatio, "16:9");
  assert.equal(flashImageResolved.imageSize, null);
  assert.deepEqual(flashImageResolved.stopSequenceList, ["cut", "fade out"]);
  assert.deepEqual(flashImageResolved.effectiveSettings, {
    temperature: 1.1,
    aspectRatio: "16:9",
    maxOutputTokens: 32000,
    topP: 0.9,
    stopSequences: "cut\nfade out",
  });

  const proResolved = resolveGeminiImageSettings(
    {
      aspectRatio: "4:5",
      imageSize: "2K",
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 2048,
      stopSequences: "the end",
    },
    "gemini-3-pro-image-preview"
  );
  assert.equal(proResolved.aspectRatio, "4:5");
  assert.equal(proResolved.imageSize, "2K");
  assert.equal(proResolved.thinkingLevel, null);
  assert.deepEqual(proResolved.effectiveSettings, {
    temperature: 0.8,
    aspectRatio: "4:5",
    imageSize: "2K",
    maxOutputTokens: 2048,
    topP: 0.95,
    stopSequences: "the end",
  });

  const flash31Resolved = resolveGeminiImageSettings(
    {
      imageSize: "512",
      thinkingLevel: "high",
    },
    "gemini-3.1-flash-image-preview"
  );
  assert.equal(flash31Resolved.imageSize, "512");
  assert.equal(flash31Resolved.thinkingLevel, "high");
  assert.equal(flash31Resolved.outputMode, "images_and_text");
  assert.equal(flash31Resolved.maxOutputTokens, 65536);
  assert.equal(flash31Resolved.temperature, 1);
  assert.equal(flash31Resolved.topP, 0.95);
});

test("builds Gemini image debug requests with Gemini generateContent config", () => {
  const debugRequest = buildGeminiImageDebugRequest({
    modelId: "gemini-3.1-flash-image-preview",
    prompt: "Render a poster.",
    executionMode: "generate",
    rawSettings: {
      outputMode: "images_and_text",
      temperature: 1,
      aspectRatio: "21:9",
      imageSize: "2K",
      thinkingLevel: "medium",
      maxOutputTokens: 8192,
      topP: 0.95,
      stopSequences: "the end\ncredits",
    },
    inputImageAssetIds: [],
  });

  assert.equal(debugRequest.endpoint, "ai.models.generateContent");
  assert.equal(debugRequest.validationError, null);
  assert.deepEqual(debugRequest.request, {
    model: "gemini-3.1-flash-image-preview",
    contents: "Render a poster.",
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      responseMimeType: "application/json",
      systemInstruction: debugRequest.request.config.systemInstruction,
      responseJsonSchema: debugRequest.request.config.responseJsonSchema,
      temperature: 1,
      topP: 0.95,
      maxOutputTokens: 8192,
      stopSequences: ["the end", "credits"],
      thinkingConfig: {
        thinkingLevel: "medium",
      },
      imageConfig: {
        aspectRatio: "21:9",
        imageSize: "2K",
      },
    },
  });
  assert.equal(typeof debugRequest.request.config.systemInstruction, "string");
  assert.equal(
    (debugRequest.request.config.responseJsonSchema as { type: string }).type,
    "object"
  );
});

test("Gemini mixed image requests keep the same text scaffolding in generate and edit modes", () => {
  const generateRequest = buildGeminiImageDebugRequest({
    modelId: "gemini-3.1-flash-image-preview",
    prompt: "Render a poster.",
    executionMode: "generate",
    rawSettings: {
      outputMode: "images_and_text",
      imageSize: "2K",
    },
    inputImageAssetIds: [],
  });
  const editRequest = buildGeminiImageDebugRequest({
    modelId: "gemini-3.1-flash-image-preview",
    prompt: "Edit this poster.",
    executionMode: "edit",
    rawSettings: {
      outputMode: "images_and_text",
      imageSize: "2K",
    },
    inputImageAssetIds: ["asset-1"],
  });

  assert.deepEqual(generateRequest.request.config, editRequest.request.config);
  assert.equal(generateRequest.request.config.responseMimeType, "application/json");
  assert.deepEqual(generateRequest.request.config.responseModalities, ["TEXT", "IMAGE"]);
  assert.deepEqual(editRequest.request.contents, [{ text: "Edit this poster." }, { inputAssetId: "asset-1" }]);
});
