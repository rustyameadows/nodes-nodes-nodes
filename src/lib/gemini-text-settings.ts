import type { ModelParameterDefinition } from "@/lib/model-parameters";
import { getStructuredTextOutputContract } from "@/lib/generated-text-output";
import {
  DEFAULT_TEXT_OUTPUT_TARGET,
  isStructuredTextOutputTarget,
  readTextOutputTarget,
} from "@/lib/text-output-targets";

export const GEMINI_RUNNABLE_TEXT_MODEL_IDS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const GEMINI_TEXT_MAX_OUTPUT_TOKENS = 65536;

export function isRunnableGeminiTextModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined
) {
  return (
    providerId === "google-gemini" &&
    typeof modelId === "string" &&
    (GEMINI_RUNNABLE_TEXT_MODEL_IDS as readonly string[]).includes(modelId)
  );
}

export function getGeminiTextDefaultSettings() {
  return {
    maxOutputTokens: null,
    textOutputTarget: DEFAULT_TEXT_OUTPUT_TARGET,
  };
}

export function getGeminiTextParameterDefinitions(): ModelParameterDefinition[] {
  return GEMINI_TEXT_PARAMETER_DEFINITIONS;
}

export const GEMINI_TEXT_PARAMETER_DEFINITIONS: ModelParameterDefinition[] = [
  {
    key: "maxOutputTokens",
    label: "Max Output Tokens",
    control: "number",
    section: "core",
    min: 1,
    max: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    step: 1,
    placeholder: "Auto",
  },
  {
    key: "textOutputTarget",
    label: "Output Target",
    control: "select",
    section: "core",
    defaultValue: DEFAULT_TEXT_OUTPUT_TARGET,
    options: [
      { value: "note", label: "Text Note" },
      { value: "list", label: "List" },
      { value: "template", label: "Template" },
      { value: "smart", label: "Smart Output" },
    ],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readMaxOutputTokens(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue) || !Number.isInteger(nextValue)) {
    return null;
  }

  return clamp(nextValue, 1, GEMINI_TEXT_MAX_OUTPUT_TOKENS);
}

export function resolveGeminiTextSettings(rawSettings: Record<string, unknown> | undefined) {
  const settings = rawSettings || {};
  const maxOutputTokens = readMaxOutputTokens(settings.maxOutputTokens);
  const textOutputTarget = readTextOutputTarget(settings.textOutputTarget, DEFAULT_TEXT_OUTPUT_TARGET);
  const effectiveSettings: Record<string, unknown> = {
    textOutputTarget,
    ...(maxOutputTokens !== null ? { maxOutputTokens } : {}),
  };

  return {
    maxOutputTokens,
    textOutputTarget,
    validationError: null,
    effectiveSettings,
  };
}

export function buildGeminiTextRequestConfig(resolved: ReturnType<typeof resolveGeminiTextSettings>) {
  if (isStructuredTextOutputTarget(resolved.textOutputTarget)) {
    const contract = getStructuredTextOutputContract(resolved.textOutputTarget);
    return {
      systemInstruction: contract.instructions,
      responseMimeType: "application/json",
      responseJsonSchema: contract.schema,
    } as const;
  }

  return {
    responseMimeType: "text/plain",
  } as const;
}

export function buildGeminiTextDebugRequest(input: {
  modelId: string;
  prompt: string;
  rawSettings: Record<string, unknown>;
}) {
  const resolved = resolveGeminiTextSettings(input.rawSettings);
  const requestConfig = buildGeminiTextRequestConfig(resolved);
  const request: Record<string, unknown> = {
    model: input.modelId,
    contents: input.prompt,
    config: {
      ...requestConfig,
      ...(resolved.maxOutputTokens !== null ? { maxOutputTokens: resolved.maxOutputTokens } : {}),
    },
  };

  return {
    endpoint: "ai.models.generateContent",
    request,
    effectiveSettings: resolved.effectiveSettings,
    validationError: resolved.validationError,
  };
}
