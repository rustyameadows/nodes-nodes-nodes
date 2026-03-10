import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiImageOutputsFromResponse,
  getProviderAdapter,
} from "@/lib/providers/registry";

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z7foAAAAASUVORK5CYII=";

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

test("Nano Banana 2 images only returns only image outputs", async () => {
  const outputs = buildGeminiImageOutputsFromResponse({
    job: {
      projectId: "project-1",
      jobId: "job-1",
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash-image-preview",
      payload: {
        nodeId: "model-1",
        nodeType: "image-gen",
        prompt: "Draw a poster.",
        settings: {
          outputMode: "images_only",
        },
        outputType: "image",
        executionMode: "generate",
        outputCount: 1,
        runOrigin: "canvas-node",
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: [],
      },
      inputAssets: [],
    },
    executionMode: "generate",
    resolvedSettings: {
      outputCount: 1,
      aspectRatio: "auto",
      temperature: 1,
      topP: 0.95,
      maxOutputTokens: 65536,
      stopSequences: null,
      stopSequenceList: [],
      imageSize: "1K",
      thinkingLevel: "minimal",
      outputMode: "images_only",
      effectiveSettings: {
        outputMode: "images_only",
      },
    },
    response: {
      text: JSON.stringify({ ignored: true }),
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(
    outputs.map((output) => output.type),
    ["image"]
  );
  assert.equal(outputs[0]?.metadata.outputIndex, 0);
});

test("Nano Banana 2 preserves all returned Gemini image parts", async () => {
  const outputs = buildGeminiImageOutputsFromResponse({
    job: {
      projectId: "project-1",
      jobId: "job-1",
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash-image-preview",
      payload: {
        nodeId: "model-1",
        nodeType: "image-gen",
        prompt: "Draw three poster variations.",
        settings: {
          outputMode: "images_and_text",
        },
        outputType: "image",
        executionMode: "generate",
        outputCount: 1,
        runOrigin: "canvas-node",
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: [],
      },
      inputAssets: [],
    },
    executionMode: "generate",
    resolvedSettings: {
      outputCount: 1,
      aspectRatio: "auto",
      temperature: 1,
      topP: 0.95,
      maxOutputTokens: 65536,
      stopSequences: null,
      stopSequenceList: [],
      imageSize: "1K",
      thinkingLevel: "minimal",
      outputMode: "images_and_text",
      effectiveSettings: {
        outputMode: "images_and_text",
      },
    },
    response: {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(
    outputs.map((output) => output.type),
    ["image", "image", "image"]
  );
  assert.deepEqual(
    outputs.map((output) => output.metadata.outputIndex),
    [0, 1, 2]
  );
  assert.deepEqual(outputs[0]?.metadata.geminiMixedOutputDiagnostics, {
    requested: true,
    experimental: true,
    mode: "images_and_text",
    executionMode: "generate",
    inputImageCount: 0,
    rawResponseTextPresent: false,
    candidateTextPartCount: 0,
    imagePartCount: 3,
    warningCode: "mixed_output_missing_text",
    warningMessage:
      "Nano Banana 2 Images & Text is experimental. Gemini returned 3 image part(s) but no text for this generate run with 0 input image(s), so the job stayed image-only.",
  });
});

test("Nano Banana 2 images and text returns image plus smart text outputs", async () => {
  const outputs = buildGeminiImageOutputsFromResponse({
    job: {
      projectId: "project-1",
      jobId: "job-1",
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash-image-preview",
      payload: {
        nodeId: "model-1",
        nodeType: "image-gen",
        prompt: "Draw a poster and write a tweet.",
        settings: {
          outputMode: "images_and_text",
        },
        outputType: "image",
        executionMode: "generate",
        outputCount: 1,
        runOrigin: "canvas-node",
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: [],
      },
      inputAssets: [],
    },
    executionMode: "generate",
    resolvedSettings: {
      outputCount: 1,
      aspectRatio: "auto",
      temperature: 1,
      topP: 0.95,
      maxOutputTokens: 65536,
      stopSequences: null,
      stopSequenceList: [],
      imageSize: "1K",
      thinkingLevel: "minimal",
      outputMode: "images_and_text",
      effectiveSettings: {
        outputMode: "images_and_text",
      },
    },
    response: {
      text: JSON.stringify({
        nodes: [
          {
            id: "tweet",
            kind: "text-note",
            label: "Tweet",
            text: "Found a cave flower on Mars.",
            columns: null,
            rows: null,
            templateText: null,
          },
        ],
        connections: [],
      }),
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
              {
                text: JSON.stringify({
                  nodes: [
                    {
                      id: "tweet",
                      kind: "text-note",
                      label: "Tweet",
                      text: "Found a cave flower on Mars.",
                      columns: null,
                      rows: null,
                      templateText: null,
                    },
                  ],
                  connections: [],
                }),
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(
    outputs.map((output) => output.type),
    ["image", "text"]
  );
  assert.equal(outputs[0]?.metadata.outputIndex, 0);
  assert.equal(outputs[1]?.metadata.outputIndex, 1);
  assert.equal(outputs[1]?.metadata.textOutputTarget, "smart");
  assert.equal(outputs[1]?.mimeType, "application/json");
  assert.deepEqual(outputs[0]?.metadata.geminiMixedOutputDiagnostics, {
    requested: true,
    experimental: true,
    mode: "images_and_text",
    executionMode: "generate",
    inputImageCount: 0,
    rawResponseTextPresent: true,
    candidateTextPartCount: 1,
    imagePartCount: 1,
    warningCode: null,
    warningMessage: null,
  });
});

test("Nano Banana 2 images and text preserves image-only edit responses with diagnostics", async () => {
  const outputs = buildGeminiImageOutputsFromResponse({
    job: {
      projectId: "project-1",
      jobId: "job-1",
      providerId: "google-gemini",
      modelId: "gemini-3.1-flash-image-preview",
      payload: {
        nodeId: "model-1",
        nodeType: "image-gen",
        prompt: "Edit this image and write a caption.",
        settings: {
          outputMode: "images_and_text",
        },
        outputType: "image",
        executionMode: "edit",
        outputCount: 1,
        runOrigin: "canvas-node",
        upstreamNodeIds: [],
        upstreamAssetIds: [],
        inputImageAssetIds: ["asset-1"],
      },
      inputAssets: [
        {
          assetId: "asset-1",
          type: "image",
          storageRef: "assets/project-1/input.png",
          mimeType: "image/png",
          buffer: Buffer.from("png"),
        },
      ],
    },
    executionMode: "edit",
    resolvedSettings: {
      outputCount: 1,
      aspectRatio: "auto",
      temperature: 1,
      topP: 0.95,
      maxOutputTokens: 65536,
      stopSequences: null,
      stopSequenceList: [],
      imageSize: "1K",
      thinkingLevel: "minimal",
      outputMode: "images_and_text",
      effectiveSettings: {
        outputMode: "images_and_text",
      },
    },
    response: {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: ONE_BY_ONE_PNG_BASE64,
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(
    outputs.map((output) => output.type),
    ["image"]
  );
  assert.deepEqual(outputs[0]?.metadata.geminiMixedOutputDiagnostics, {
    requested: true,
    experimental: true,
    mode: "images_and_text",
    executionMode: "edit",
    inputImageCount: 1,
    rawResponseTextPresent: false,
    candidateTextPartCount: 0,
    imagePartCount: 1,
    warningCode: "mixed_output_missing_text",
    warningMessage:
      "Nano Banana 2 Images & Text is experimental. Gemini returned 1 image part(s) but no text for this edit run with 1 input image(s), so the job stayed image-only.",
  });
});
