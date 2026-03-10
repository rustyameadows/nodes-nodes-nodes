import { GoogleGenAI } from "@google/genai";
import { resolveProviderCredentialValue } from "@/lib/runtime/provider-credentials";
import type {
  ProviderInputAsset,
  ProviderModelAccessReason,
  ProviderModelAccessStatus,
} from "@/lib/types";

type GoogleGeminiClientLike = Pick<GoogleGenAI, "models">;
type GoogleGeminiCandidatePart = {
  text?: string;
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
};
type GoogleGeminiResponseShape = {
  text?: string | undefined;
  candidates?: Array<{
    content?: {
      parts?: GoogleGeminiCandidatePart[];
    };
  }>;
};

type GoogleGeminiAccessUpdate = {
  accessStatus: ProviderModelAccessStatus;
  accessReason: ProviderModelAccessReason | null;
  accessMessage: string | null;
};

export type GoogleGeminiErrorClassification = {
  code:
    | "BILLING_REQUIRED"
    | "PERMISSION_DENIED"
    | "NOT_LISTED"
    | "INVALID_INPUT"
    | "QUOTA_EXHAUSTED"
    | "RATE_LIMITED"
    | "TEMPORARY_UNAVAILABLE"
    | "PROVIDER_ERROR";
  message: string;
  retryable: boolean;
  accessUpdate: GoogleGeminiAccessUpdate | null;
  details: Record<string, unknown>;
};

let googleGeminiClientFactoryForTests: (() => Promise<GoogleGeminiClientLike>) | null = null;

function buildGoogleGeminiClient(apiKey: string): GoogleGeminiClientLike {
  return new GoogleGenAI({ apiKey });
}

export async function getGoogleGeminiClient() {
  if (googleGeminiClientFactoryForTests) {
    return googleGeminiClientFactoryForTests();
  }

  const apiKey = await resolveProviderCredentialValue("GOOGLE_API_KEY");
  if (!apiKey) {
    throw new Error("Google Gemini is not configured.");
  }

  return buildGoogleGeminiClient(apiKey);
}

export function setGoogleGeminiClientFactoryForTests(
  factory: (() => Promise<GoogleGeminiClientLike>) | null
) {
  googleGeminiClientFactoryForTests = factory;
}

export function normalizeGoogleGeminiModelId(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.replace(/^models\//, "");
}

export async function listGoogleGeminiAvailableModelIds() {
  const ai = await getGoogleGeminiClient();
  const pager = await ai.models.list({
    config: {
      pageSize: 100,
      queryBase: true,
    },
  });
  const modelIds = new Set<string>();

  for await (const model of pager) {
    const modelId = normalizeGoogleGeminiModelId(model.name);
    if (modelId) {
      modelIds.add(modelId);
    }
  }

  return {
    modelIds,
    checkedAt: new Date().toISOString(),
  };
}

export function buildGoogleGeminiContents(prompt: string, inputAssets: ProviderInputAsset[]) {
  if (inputAssets.length === 0) {
    return prompt;
  }

  return [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...inputAssets.map((asset) => ({
          inlineData: {
            data: asset.buffer.toString("base64"),
            mimeType: asset.mimeType,
          },
        })),
      ],
    },
  ];
}

export function extractGoogleGeminiText(response: GoogleGeminiResponseShape) {
  const directText = response.text?.trim();
  if (directText) {
    return directText;
  }

  const candidateParts = response.candidates?.[0]?.content?.parts || [];
  const text = candidateParts
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text ? text : null;
}

export function extractGoogleGeminiImageParts(response: GoogleGeminiResponseShape) {
  const parts = response.candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => part.inlineData || null)
    .filter(
      (part): part is NonNullable<(typeof parts)[number]["inlineData"]> =>
        Boolean(part?.data && part?.mimeType)
    )
    .map((part) => ({
      data: part.data!,
      mimeType: part.mimeType!,
    }));
}

export function inspectGoogleGeminiMixedOutputResponse(response: GoogleGeminiResponseShape) {
  const candidateParts = response.candidates?.[0]?.content?.parts || [];

  return {
    rawResponseTextPresent: Boolean(response.text?.trim()),
    candidateTextPartCount: candidateParts.filter((part) => typeof part.text === "string" && part.text.trim()).length,
    imagePartCount: extractGoogleGeminiImageParts(response).length,
  };
}

export function classifyGoogleGeminiError(error: unknown): GoogleGeminiErrorClassification {
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Google Gemini request failed.";
  const normalizedMessage = message.toLowerCase();
  const details: Record<string, unknown> = {
    provider: "google-gemini",
    ...(status ? { status } : {}),
  };

  if (
    status === 403 &&
    (normalizedMessage.includes("billing") || normalizedMessage.includes("payment") || normalizedMessage.includes("paid"))
  ) {
    return {
      code: "BILLING_REQUIRED",
      message: "This Gemini model requires billing on the current Google project.",
      retryable: false,
      accessUpdate: {
        accessStatus: "blocked",
        accessReason: "billing_required",
        accessMessage: "Requires a paid Gemini API project.",
      },
      details,
    };
  }

  if (
    status === 403 &&
    (normalizedMessage.includes("permission") ||
      normalizedMessage.includes("access") ||
      normalizedMessage.includes("forbidden"))
  ) {
    return {
      code: "PERMISSION_DENIED",
      message: "The current Google project does not have permission to use this Gemini model.",
      retryable: false,
      accessUpdate: {
        accessStatus: "blocked",
        accessReason: "permission_denied",
        accessMessage: "This Gemini project does not have permission to use this model.",
      },
      details,
    };
  }

  if (
    status === 404 ||
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("not supported") ||
    normalizedMessage.includes("not available")
  ) {
    return {
      code: "NOT_LISTED",
      message: "This Gemini model is unavailable for the current Google project.",
      retryable: false,
      accessUpdate: {
        accessStatus: "blocked",
        accessReason: "not_listed",
        accessMessage: "Unavailable for this Gemini project.",
      },
      details,
    };
  }

  if (status === 429 && normalizedMessage.includes("quota")) {
    return {
      code: "QUOTA_EXHAUSTED",
      message: "This Gemini project is temporarily limited because its quota is exhausted.",
      retryable: false,
      accessUpdate: {
        accessStatus: "limited",
        accessReason: "quota_exhausted",
        accessMessage: "This Gemini project is temporarily limited because its quota is exhausted.",
      },
      details,
    };
  }

  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "This Gemini project is currently rate limited.",
      retryable: true,
      accessUpdate: {
        accessStatus: "limited",
        accessReason: "rate_limited",
        accessMessage: "This Gemini project is currently rate limited.",
      },
      details,
    };
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return {
      code: "TEMPORARY_UNAVAILABLE",
      message: "Gemini is temporarily unavailable for this model.",
      retryable: true,
      accessUpdate: {
        accessStatus: "limited",
        accessReason: "temporary_unavailable",
        accessMessage: "Gemini is temporarily unavailable for this model.",
      },
      details,
    };
  }

  if (status === 400) {
    return {
      code: "INVALID_INPUT",
      message,
      retryable: false,
      accessUpdate: {
        accessStatus: "blocked",
        accessReason: "invalid_input",
        accessMessage: message,
      },
      details,
    };
  }

  return {
    code: "PROVIDER_ERROR",
    message,
    retryable: false,
    accessUpdate: null,
    details,
  };
}
