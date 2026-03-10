import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneratedTextResultFromOutputs, buildJobAttemptProviderResponse } from "@/lib/server/job-processor";
import type { NormalizedOutput } from "@/lib/types";

test("buildGeneratedTextResultFromOutputs parses smart text from mixed image jobs", () => {
  const outputs: NormalizedOutput[] = [
    {
      type: "image",
      mimeType: "image/png",
      extension: "png",
      encoding: "binary",
      metadata: {
        outputIndex: 0,
      },
      content: Buffer.from("png"),
    },
    {
      type: "text",
      mimeType: "application/json",
      extension: "json",
      encoding: "utf-8",
      metadata: {
        outputIndex: 1,
        textOutputTarget: "smart",
      },
      content: JSON.stringify({
        nodes: [
          {
            id: "tweet",
            kind: "text-note",
            label: "Tweet",
            text: "Mars cave flower discovered.",
            columns: null,
            rows: null,
            templateText: null,
          },
        ],
        connections: [],
      }),
    },
  ];

  const result = buildGeneratedTextResultFromOutputs({
    outputs,
    fallbackTextOutputTarget: "note",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });

  assert.equal(result.textOutputTarget, "smart");
  assert.equal(result.textOutputs.length, 1);
  assert.equal(result.textOutputs[0]?.outputIndex, 1);
  assert.equal(result.generatedNodeDescriptorResult?.generatedNodeDescriptors.length, 1);
  assert.deepEqual(
    result.generatedNodeDescriptorResult?.generatedNodeDescriptors.map((descriptor) => descriptor.kind),
    ["text-note"]
  );
});

test("buildJobAttemptProviderResponse persists mixed image-only diagnostics without fake text descriptors", () => {
  const outputs: NormalizedOutput[] = [
    {
      type: "image",
      mimeType: "image/png",
      extension: "png",
      encoding: "binary",
      metadata: {
        outputIndex: 0,
        geminiMixedOutputDiagnostics: {
          requested: true,
          experimental: true,
          mode: "images_and_text",
          executionMode: "edit",
          inputImageCount: 1,
          rawResponseTextPresent: false,
          candidateTextPartCount: 0,
          imagePartCount: 1,
          warningCode: "mixed_output_missing_text",
          warningMessage: "Mixed output returned image only.",
        },
      },
      content: Buffer.from("png"),
    },
  ];

  const providerResponse = buildJobAttemptProviderResponse({
    outputs,
    persistedPreviewFrames: [],
    generatedTextResult: buildGeneratedTextResultFromOutputs({
      outputs,
      fallbackTextOutputTarget: "note",
      sourceJobId: "job-1",
      sourceModelNodeId: "model-1",
      runOrigin: "canvas-node",
    }),
    topazApiMetadata: null,
  });

  assert.equal(providerResponse.outputCount, 1);
  assert.deepEqual(providerResponse.outputTypes, ["image"]);
  assert.equal("textOutputTarget" in providerResponse, false);
  assert.equal("generatedNodeDescriptors" in providerResponse, false);
  assert.deepEqual(providerResponse.mixedOutputDiagnostics, outputs[0]?.metadata.geminiMixedOutputDiagnostics);
});

test("buildJobAttemptProviderResponse persists mixed image-plus-text outputs and generated descriptors", () => {
  const outputs: NormalizedOutput[] = [
    {
      type: "image",
      mimeType: "image/png",
      extension: "png",
      encoding: "binary",
      metadata: {
        outputIndex: 0,
        geminiMixedOutputDiagnostics: {
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
        },
      },
      content: Buffer.from("png"),
    },
    {
      type: "text",
      mimeType: "application/json",
      extension: "json",
      encoding: "utf-8",
      metadata: {
        outputIndex: 1,
        textOutputTarget: "smart",
      },
      content: JSON.stringify({
        nodes: [
          {
            id: "tweet",
            kind: "text-note",
            label: "Tweet",
            text: "Mars cave flower discovered.",
            columns: null,
            rows: null,
            templateText: null,
          },
        ],
        connections: [],
      }),
    },
  ];

  const generatedTextResult = buildGeneratedTextResultFromOutputs({
    outputs,
    fallbackTextOutputTarget: "note",
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });
  const providerResponse = buildJobAttemptProviderResponse({
    outputs,
    persistedPreviewFrames: [],
    generatedTextResult,
    topazApiMetadata: null,
  });

  assert.equal(providerResponse.textOutputTarget, "smart");
  assert.equal(providerResponse.outputs[1]?.type, "text");
  assert.equal(providerResponse.outputs[1]?.content, outputs[1]?.content);
  assert.equal(providerResponse.generatedNodeDescriptors?.length, 1);
  assert.deepEqual(providerResponse.mixedOutputDiagnostics, outputs[0]?.metadata.geminiMixedOutputDiagnostics);
});
