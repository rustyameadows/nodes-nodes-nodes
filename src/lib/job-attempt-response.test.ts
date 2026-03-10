import assert from "node:assert/strict";
import test from "node:test";
import {
  getGeneratedOutputData,
  getGeminiMixedOutputDiagnostics,
  getStoredTextOutputTarget,
} from "@/lib/job-attempt-response";

test("getGeneratedOutputData round-trips explicit generated descriptors", () => {
  const providerResponse = {
    generatedNodeDescriptors: [
      {
        descriptorId: "tweet",
        kind: "text-note",
        label: "Tweet",
        sourceJobId: "job-1",
        sourceModelNodeId: "model-1",
        outputIndex: 1,
        descriptorIndex: 0,
        runOrigin: "canvas-node",
        text: "Hello Mars",
      },
    ],
    generatedConnections: [],
    generatedNodeDescriptorWarning: "Existing warning.",
  };

  const result = getGeneratedOutputData({
    providerResponse,
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });

  assert.equal(result.generatedNodeDescriptors.length, 1);
  assert.equal(result.generatedNodeDescriptors[0]?.descriptorId, "tweet");
  assert.equal(result.warning, "Existing warning.");
});

test("getGeneratedOutputData reparses smart text outputs when descriptors are missing", () => {
  const providerResponse = {
    outputs: [
      {
        type: "image",
        mimeType: "image/png",
        extension: "png",
        metadata: {
          outputIndex: 0,
        },
      },
      {
        type: "text",
        mimeType: "application/json",
        extension: "json",
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
  };

  const result = getGeneratedOutputData({
    providerResponse,
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });

  assert.equal(getStoredTextOutputTarget(providerResponse, null), "smart");
  assert.equal(result.generatedNodeDescriptors.length, 1);
  assert.equal(result.generatedNodeDescriptors[0]?.kind, "text-note");
  assert.equal(result.generatedConnections.length, 0);
});

test("mixed image-only attempts stay image-only while exposing typed diagnostics", () => {
  const providerResponse = {
    outputs: [
      {
        type: "image",
        mimeType: "image/png",
        extension: "png",
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
      },
    ],
  };

  const result = getGeneratedOutputData({
    providerResponse,
    sourceJobId: "job-1",
    sourceModelNodeId: "model-1",
    runOrigin: "canvas-node",
  });

  assert.deepEqual(result, {
    generatedNodeDescriptors: [],
    generatedConnections: [],
    warning: null,
  });
  assert.deepEqual(getGeminiMixedOutputDiagnostics(providerResponse), providerResponse.outputs[0]?.metadata.geminiMixedOutputDiagnostics);
});
