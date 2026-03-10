import type { ModelParameterDefinition } from "@/lib/model-parameters";
import { getStructuredTextOutputContract } from "@/lib/generated-text-output";
import {
  DEFAULT_TEXT_OUTPUT_TARGET,
  isStructuredTextOutputTarget,
  readTextOutputTarget,
} from "@/lib/text-output-targets";

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export const GEMINI_RUNNABLE_TEXT_MODEL_IDS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

type GeminiTextThinkingProfile =
  | {
      kind: "level";
      defaultValue: GeminiThinkingLevel;
      options: readonly GeminiThinkingLevel[];
      helpText: string;
    }
  | {
      kind: "budget";
      defaultValue: number;
      max: number;
      allowDisabled: boolean;
      helpText: string;
    };

type GeminiTextModelProfile = {
  maxOutputTokens: number;
  thinking: GeminiTextThinkingProfile;
};

type GeminiTextResolvedSettings = {
  maxOutputTokens: number | null;
  textOutputTarget: "note" | "list" | "template" | "smart";
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  thinkingLevel: GeminiThinkingLevel | null;
  thinkingBudget: number | null;
  validationError: string | null;
  effectiveSettings: Record<string, unknown>;
};

const GEMINI_TEXT_MAX_OUTPUT_TOKENS = 65536;
const GEMINI_TEMPERATURE_MIN = 0;
const GEMINI_TEMPERATURE_MAX = 2;
const GEMINI_TOP_P_MIN = 0;
const GEMINI_TOP_P_MAX = 1;
const GEMINI_TOP_K_MIN = 1;

const GEMINI_THINKING_LEVEL_OPTIONS: ModelParameterDefinition["options"] = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const GEMINI_TEXT_MODEL_PROFILES: Record<(typeof GEMINI_RUNNABLE_TEXT_MODEL_IDS)[number], GeminiTextModelProfile> = {
  "gemini-3.1-flash-lite-preview": {
    maxOutputTokens: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    thinking: {
      kind: "level",
      defaultValue: "high",
      options: ["minimal", "low", "medium", "high"],
      helpText: "Flash-family Gemini 3 models use thinking levels instead of token budgets.",
    },
  },
  "gemini-3-flash-preview": {
    maxOutputTokens: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    thinking: {
      kind: "level",
      defaultValue: "high",
      options: ["minimal", "low", "medium", "high"],
      helpText: "Flash-family Gemini 3 models use thinking levels instead of token budgets.",
    },
  },
  "gemini-2.5-pro": {
    maxOutputTokens: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    thinking: {
      kind: "budget",
      defaultValue: -1,
      max: 32768,
      allowDisabled: false,
      helpText: "Use -1 for dynamic thinking. Gemini 2.5 Pro does not support disabling thinking.",
    },
  },
  "gemini-2.5-flash": {
    maxOutputTokens: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    thinking: {
      kind: "budget",
      defaultValue: -1,
      max: 24576,
      allowDisabled: true,
      helpText: "Use -1 for dynamic thinking, 0 to disable, or a positive budget up to 24576.",
    },
  },
  "gemini-2.5-flash-lite": {
    maxOutputTokens: GEMINI_TEXT_MAX_OUTPUT_TOKENS,
    thinking: {
      kind: "budget",
      defaultValue: 0,
      max: 24576,
      allowDisabled: true,
      helpText: "Use 0 to keep Flash-Lite fast, -1 for dynamic thinking, or a positive budget up to 24576.",
    },
  },
};

const GEMINI_SHARED_TEXT_PARAMETER_DEFINITIONS: ModelParameterDefinition[] = [
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
  {
    key: "temperature",
    label: "Temperature",
    control: "number",
    section: "advanced",
    min: GEMINI_TEMPERATURE_MIN,
    max: GEMINI_TEMPERATURE_MAX,
    step: 0.1,
    placeholder: "Model default",
  },
  {
    key: "topP",
    label: "Top P",
    control: "number",
    section: "advanced",
    min: GEMINI_TOP_P_MIN,
    max: GEMINI_TOP_P_MAX,
    step: 0.05,
    placeholder: "Model default",
  },
  {
    key: "topK",
    label: "Top K",
    control: "number",
    section: "advanced",
    min: GEMINI_TOP_K_MIN,
    step: 1,
    placeholder: "Model default",
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readOptionalNumber(
  value: unknown,
  options: {
    min: number;
    max?: number;
    integer?: boolean;
  }
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue)) {
    return null;
  }

  if (options.integer && !Number.isInteger(nextValue)) {
    return null;
  }

  if (options.max === undefined) {
    return Math.max(options.min, nextValue);
  }

  return clamp(nextValue, options.min, options.max);
}

function readThinkingLevel(
  value: unknown,
  profile: Extract<GeminiTextThinkingProfile, { kind: "level" }>
): GeminiThinkingLevel {
  return profile.options.includes(value as GeminiThinkingLevel)
    ? (value as GeminiThinkingLevel)
    : profile.defaultValue;
}

function readThinkingBudget(
  value: unknown,
  profile: Extract<GeminiTextThinkingProfile, { kind: "budget" }>
) {
  const fallback = {
    thinkingBudget: profile.defaultValue,
    validationError: null,
  } as const;

  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue) || !Number.isInteger(nextValue)) {
    return fallback;
  }

  if (nextValue === -1) {
    return fallback.thinkingBudget === -1
      ? fallback
      : {
          thinkingBudget: -1,
          validationError: null,
        };
  }

  if (nextValue === 0) {
    if (profile.allowDisabled) {
      return {
        thinkingBudget: 0,
        validationError: null,
      };
    }

    return {
      thinkingBudget: profile.defaultValue,
      validationError: "Gemini 2.5 Pro does not support disabling thinking.",
    };
  }

  if (nextValue < 1 || nextValue > profile.max) {
    return {
      thinkingBudget: profile.defaultValue,
      validationError: `Thinking Budget must be -1,${profile.allowDisabled ? " 0," : ""} or a positive integer up to ${profile.max}.`,
    };
  }

  return {
    thinkingBudget: nextValue,
    validationError: null,
  };
}

function thinkingParameterDefinition(profile: GeminiTextThinkingProfile): ModelParameterDefinition {
  if (profile.kind === "level") {
    return {
      key: "thinkingLevel",
      label: "Thinking Level",
      control: "select",
      section: "advanced",
      defaultValue: profile.defaultValue,
      helpText: profile.helpText,
      options: GEMINI_THINKING_LEVEL_OPTIONS.filter((option) =>
        profile.options.includes(option.value as GeminiThinkingLevel)
      ),
    };
  }

  return {
    key: "thinkingBudget",
    label: "Thinking Budget",
    control: "number",
    section: "advanced",
    defaultValue: profile.defaultValue,
    min: -1,
    max: profile.max,
    step: 1,
    helpText: profile.helpText,
    placeholder: profile.defaultValue === -1 ? "Dynamic (-1)" : String(profile.defaultValue),
  };
}

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

export function getGeminiTextModelProfile(modelId: string | null | undefined): GeminiTextModelProfile {
  if (modelId && modelId in GEMINI_TEXT_MODEL_PROFILES) {
    return GEMINI_TEXT_MODEL_PROFILES[modelId as keyof typeof GEMINI_TEXT_MODEL_PROFILES];
  }

  return GEMINI_TEXT_MODEL_PROFILES["gemini-3-flash-preview"];
}

export function getGeminiTextDefaultSettings(modelId: string | null | undefined) {
  const profile = getGeminiTextModelProfile(modelId);

  return {
    textOutputTarget: DEFAULT_TEXT_OUTPUT_TARGET,
    ...(profile.thinking.kind === "level"
      ? { thinkingLevel: profile.thinking.defaultValue }
      : { thinkingBudget: profile.thinking.defaultValue }),
  };
}

export function getGeminiTextParameterDefinitions(modelId: string | null | undefined): ModelParameterDefinition[] {
  const profile = getGeminiTextModelProfile(modelId);
  return [...GEMINI_SHARED_TEXT_PARAMETER_DEFINITIONS, thinkingParameterDefinition(profile.thinking)];
}

export function resolveGeminiTextSettings(
  rawSettings: Record<string, unknown> | undefined,
  modelId: string | null | undefined
): GeminiTextResolvedSettings {
  const settings = rawSettings || {};
  const profile = getGeminiTextModelProfile(modelId);
  const maxOutputTokens = readOptionalNumber(settings.maxOutputTokens, {
    min: 1,
    max: profile.maxOutputTokens,
    integer: true,
  });
  const temperature = readOptionalNumber(settings.temperature, {
    min: GEMINI_TEMPERATURE_MIN,
    max: GEMINI_TEMPERATURE_MAX,
  });
  const topP = readOptionalNumber(settings.topP, {
    min: GEMINI_TOP_P_MIN,
    max: GEMINI_TOP_P_MAX,
  });
  const topK = readOptionalNumber(settings.topK, {
    min: GEMINI_TOP_K_MIN,
    integer: true,
  });
  const textOutputTarget = readTextOutputTarget(settings.textOutputTarget, DEFAULT_TEXT_OUTPUT_TARGET);

  let thinkingLevel: GeminiThinkingLevel | null = null;
  let thinkingBudget: number | null = null;
  let validationError: string | null = null;

  if (profile.thinking.kind === "level") {
    thinkingLevel = readThinkingLevel(settings.thinkingLevel, profile.thinking);
  } else {
    const resolvedThinkingBudget = readThinkingBudget(settings.thinkingBudget, profile.thinking);
    thinkingBudget = resolvedThinkingBudget.thinkingBudget;
    validationError = resolvedThinkingBudget.validationError;
  }

  const effectiveSettings: Record<string, unknown> = {
    textOutputTarget,
    ...(maxOutputTokens !== null ? { maxOutputTokens } : {}),
    ...(temperature !== null ? { temperature } : {}),
    ...(topP !== null ? { topP } : {}),
    ...(topK !== null ? { topK } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(thinkingBudget !== null ? { thinkingBudget } : {}),
  };

  return {
    maxOutputTokens,
    textOutputTarget,
    temperature,
    topP,
    topK,
    thinkingLevel,
    thinkingBudget,
    validationError,
    effectiveSettings,
  };
}

export function buildGeminiTextRequestConfig(
  resolved: GeminiTextResolvedSettings
) {
  const config: Record<string, unknown> = {
    responseMimeType: isStructuredTextOutputTarget(resolved.textOutputTarget) ? "application/json" : "text/plain",
  };

  if (isStructuredTextOutputTarget(resolved.textOutputTarget)) {
    const contract = getStructuredTextOutputContract(resolved.textOutputTarget);
    config.systemInstruction = contract.instructions;
    config.responseJsonSchema = contract.schema;
  }

  if (resolved.maxOutputTokens !== null) {
    config.maxOutputTokens = resolved.maxOutputTokens;
  }
  if (resolved.temperature !== null) {
    config.temperature = resolved.temperature;
  }
  if (resolved.topP !== null) {
    config.topP = resolved.topP;
  }
  if (resolved.topK !== null) {
    config.topK = resolved.topK;
  }
  if (resolved.thinkingLevel) {
    config.thinkingConfig = {
      thinkingLevel: resolved.thinkingLevel,
    };
  } else if (resolved.thinkingBudget !== null) {
    config.thinkingConfig = {
      thinkingBudget: resolved.thinkingBudget,
    };
  }

  return config;
}

export function buildGeminiTextDebugRequest(input: {
  modelId: string;
  prompt: string;
  rawSettings: Record<string, unknown>;
}) {
  const resolved = resolveGeminiTextSettings(input.rawSettings, input.modelId);
  const request: Record<string, unknown> = {
    model: input.modelId,
    contents: input.prompt,
    config: buildGeminiTextRequestConfig(resolved),
  };

  return {
    endpoint: "ai.models.generateContent",
    request,
    effectiveSettings: resolved.effectiveSettings,
    validationError: resolved.validationError,
  };
}
