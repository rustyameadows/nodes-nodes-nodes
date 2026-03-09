import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleGeminiContents,
  classifyGoogleGeminiError,
  extractGoogleGeminiImageParts,
} from "@/lib/server/google-gemini";

test("classifies Gemini billing and quota errors into access states", () => {
  const billingError = classifyGoogleGeminiError({
    status: 403,
    message: "Billing required for this model",
  });
  assert.equal(billingError.code, "BILLING_REQUIRED");
  assert.equal(billingError.retryable, false);
  assert.deepEqual(billingError.accessUpdate, {
    accessStatus: "blocked",
    accessReason: "billing_required",
    accessMessage: "Requires a paid Gemini API project.",
  });

  const quotaError = classifyGoogleGeminiError({
    status: 429,
    message: "Quota exceeded for this request",
  });
  assert.equal(quotaError.code, "QUOTA_EXHAUSTED");
  assert.equal(quotaError.retryable, false);
  assert.deepEqual(quotaError.accessUpdate, {
    accessStatus: "limited",
    accessReason: "quota_exhausted",
    accessMessage: "This Gemini project is temporarily limited because its quota is exhausted.",
  });
});

test("builds multimodal Gemini contents and extracts image bytes", () => {
  const contents = buildGoogleGeminiContents("Edit this image", [
    {
      assetId: "asset-1",
      type: "image",
      storageRef: "assets/project/asset-1.png",
      mimeType: "image/png",
      buffer: Buffer.from("png-bytes"),
    },
  ]);

  assert.deepEqual(contents, [
    {
      role: "user",
      parts: [
        { text: "Edit this image" },
        {
          inlineData: {
            data: Buffer.from("png-bytes").toString("base64"),
            mimeType: "image/png",
          },
        },
      ],
    },
  ]);

  const imageParts = extractGoogleGeminiImageParts({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: "abc123",
                mimeType: "image/png",
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(imageParts, [
    {
      data: "abc123",
      mimeType: "image/png",
    },
  ]);
});
