import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleGeminiContents,
  classifyGoogleGeminiError,
  extractGoogleGeminiImageParts,
  extractGoogleGeminiText,
  inspectGoogleGeminiMixedOutputResponse,
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

test("extracts Gemini text from direct text and candidate parts", () => {
  assert.equal(extractGoogleGeminiText({ text: "  hello world  " }), "hello world");

  assert.equal(
    extractGoogleGeminiText({
      candidates: [
        {
          content: {
            parts: [
              { text: "First paragraph." },
              {
                inlineData: {
                  data: "abc123",
                  mimeType: "image/png",
                },
              },
              { text: "Second paragraph." },
            ],
          },
        },
      ],
    }),
    "First paragraph.\n\nSecond paragraph."
  );
});

test("inspects Gemini mixed output responses for image and text presence", () => {
  const stats = inspectGoogleGeminiMixedOutputResponse({
    text: "  {\"nodes\":[]}  ",
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
            { text: "extra candidate text" },
          ],
        },
      },
    ],
  });

  assert.deepEqual(stats, {
    rawResponseTextPresent: true,
    candidateTextPartCount: 1,
    imagePartCount: 1,
  });
});
