import assert from "node:assert/strict";
import test from "node:test";
import {
  formatGeminiMixedOutputDiagnosticsNotice,
  getGeminiMixedOutputDiagnosticsFromOutputs,
} from "@/lib/gemini-mixed-output";
import type { NormalizedOutput } from "@/lib/types";

test("getGeminiMixedOutputDiagnosticsFromOutputs reads diagnostics from output metadata", () => {
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

  assert.deepEqual(
    getGeminiMixedOutputDiagnosticsFromOutputs(outputs),
    outputs[0]?.metadata.geminiMixedOutputDiagnostics
  );
});

test("formatGeminiMixedOutputDiagnosticsNotice returns a readable queue/debug explanation", () => {
  assert.equal(
    formatGeminiMixedOutputDiagnosticsNotice({
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
    }),
    "Nano Banana 2 Images & Text is experimental. Gemini returned 1 image part(s) but no text for this edit run with 1 input image(s), so the job stayed image-only."
  );
});
