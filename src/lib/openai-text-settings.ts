import type { ModelParameterDefinition } from "@/lib/model-parameters";
import { getStructuredTextOutputContract } from "@/lib/generated-text-output";
import {
  OPENAI_DEFAULT_TEXT_OUTPUT_TARGET,
  isStructuredTextOutputTarget,
  readOpenAiTextOutputTarget,
} from "@/lib/text-output-targets";

export type OpenAiTextVerbosity = "low" | "medium" | "high";
export type OpenAiTextOutputFormat = "text" | "json_object" | "json_schema";
export type OpenAiTextReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const OPENAI_DEFAULT_TEXT_VERBOSITY: OpenAiTextVerbosity = "medium";
export const OPENAI_DEFAULT_TEXT_OUTPUT_FORMAT: OpenAiTextOutputFormat = "text";
export const OPENAI_TEXT_MAX_OUTPUT_TOKENS = 128000;
export const OPENAI_RUNNABLE_TEXT_MODEL_IDS = ["gpt-5.4", "gpt-5-mini", "gpt-5-nano"] as const;

type OpenAiTextModelProfile = {
  supportedReasoningEffortValues: readonly OpenAiTextReasoningEffort[];
  defaultReasoningEffort: OpenAiTextReasoningEffort;
  defaultVerbosity: OpenAiTextVerbosity;
  maxOutputTokens: number;
};

const gpt5CommonProfile: OpenAiTextModelProfile = {
  supportedReasoningEffortValues: ["minimal", "low", "medium", "high"],
  defaultReasoningEffort: "minimal",
  defaultVerbosity: OPENAI_DEFAULT_TEXT_VERBOSITY,
  maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS,
};

const OPENAI_TEXT_MODEL_PROFILES: Record<(typeof OPENAI_RUNNABLE_TEXT_MODEL_IDS)[number], OpenAiTextModelProfile> = {
  "gpt-5.4": {
    supportedReasoningEffortValues: ["none", "low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "none",
    defaultVerbosity: OPENAI_DEFAULT_TEXT_VERBOSITY,
    maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS,
  },
  "gpt-5-mini": gpt5CommonProfile,
  "gpt-5-nano": gpt5CommonProfile,
};

const jsonSchemaNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isRunnableOpenAiTextModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined
) {
  return (
    providerId === "openai" &&
    typeof modelId === "string" &&
    (OPENAI_RUNNABLE_TEXT_MODEL_IDS as readonly string[]).includes(modelId)
  );
}

export function getOpenAiTextModelProfile(modelId: string | null | undefined): OpenAiTextModelProfile {
  if (modelId && modelId in OPENAI_TEXT_MODEL_PROFILES) {
    return OPENAI_TEXT_MODEL_PROFILES[modelId as keyof typeof OPENAI_TEXT_MODEL_PROFILES];
  }

  return OPENAI_TEXT_MODEL_PROFILES["gpt-5.4"];
}

export function getOpenAiTextDefaultSettings(modelId: string | null | undefined) {
  const profile = getOpenAiTextModelProfile(modelId);

  return {
    maxOutputTokens: null,
    textOutputTarget: OPENAI_DEFAULT_TEXT_OUTPUT_TARGET,
    verbosity: profile.defaultVerbosity,
    outputFormat: OPENAI_DEFAULT_TEXT_OUTPUT_FORMAT,
    reasoningEffort: profile.defaultReasoningEffort,
    jsonSchemaName: "",
    jsonSchemaDefinition: "",
  };
}

export function getOpenAiTextParameterDefinitions(modelId: string | null | undefined): ModelParameterDefinition[] {
  const profile = getOpenAiTextModelProfile(modelId);

  return OPENAI_TEXT_PARAMETER_DEFINITIONS.map((definition) => {
    if (definition.key !== "reasoningEffort" || !definition.options) {
      return definition;
    }

    return {
      ...definition,
      options: definition.options.filter((option) =>
        profile.supportedReasoningEffortValues.includes(option.value as OpenAiTextReasoningEffort)
      ),
      defaultValue: profile.defaultReasoningEffort,
    };
  });
}

export const OPENAI_TEXT_PARAMETER_DEFINITIONS: ModelParameterDefinition[] = [
  {
    key: "maxOutputTokens",
    label: "Max Output Tokens",
    control: "number",
    section: "core",
    min: 1,
    max: OPENAI_TEXT_MAX_OUTPUT_TOKENS,
    step: 1,
    placeholder: "Auto",
  },
  {
    key: "textOutputTarget",
    label: "Output Target",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_TEXT_OUTPUT_TARGET,
    options: [
      { value: "note", label: "Text Note" },
      { value: "list", label: "List" },
      { value: "template", label: "Template" },
      { value: "smart", label: "Smart Output" },
    ],
  },
  {
    key: "verbosity",
    label: "Verbosity",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_TEXT_VERBOSITY,
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  {
    key: "outputFormat",
    label: "Output Format",
    control: "select",
    section: "core",
    defaultValue: OPENAI_DEFAULT_TEXT_OUTPUT_FORMAT,
    visibleWhen: [{ settingKey: "textOutputTarget", values: ["note"] }],
    options: [
      { value: "text", label: "Text" },
      { value: "json_object", label: "JSON Object" },
      { value: "json_schema", label: "JSON Schema" },
    ],
  },
  {
    key: "reasoningEffort",
    label: "Reasoning Effort",
    control: "select",
    section: "advanced",
    options: [
      { value: "none", label: "None" },
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "X-High" },
    ],
  },
  {
    key: "jsonSchemaName",
    label: "Schema Name",
    control: "text",
    section: "advanced",
    placeholder: "prompt_output",
    visibleWhen: [
      { settingKey: "textOutputTarget", values: ["note"] },
      { settingKey: "outputFormat", values: ["json_schema"] },
    ],
  },
  {
    key: "jsonSchemaDefinition",
    label: "Schema JSON",
    control: "textarea",
    section: "advanced",
    placeholder: '{\n  "type": "object",\n  "properties": {\n    "prompt": { "type": "string" }\n  },\n  "required": ["prompt"]\n}',
    rows: 10,
    visibleWhen: [
      { settingKey: "textOutputTarget", values: ["note"] },
      { settingKey: "outputFormat", values: ["json_schema"] },
    ],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readVerbosity(value: unknown, fallback: OpenAiTextVerbosity): OpenAiTextVerbosity {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function readOutputFormat(value: unknown, fallback: OpenAiTextOutputFormat): OpenAiTextOutputFormat {
  return value === "text" || value === "json_object" || value === "json_schema" ? value : fallback;
}

function readReasoningEffort(
  value: unknown,
  profile: OpenAiTextModelProfile
): OpenAiTextReasoningEffort {
  return profile.supportedReasoningEffortValues.includes(value as OpenAiTextReasoningEffort)
    ? (value as OpenAiTextReasoningEffort)
    : profile.defaultReasoningEffort;
}

function readMaxOutputTokens(value: unknown, profile: OpenAiTextModelProfile) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const nextValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(nextValue) || !Number.isInteger(nextValue)) {
    return null;
  }

  return clamp(nextValue, 1, profile.maxOutputTokens);
}

function readJsonSchemaName(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function readJsonSchemaDefinition(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function parseJsonSchemaDefinition(value: string | null) {
  if (!value) {
    return { parsed: null, error: "Schema JSON is required for JSON Schema output." };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { parsed: null, error: "Schema JSON must parse to an object." };
    }
    return { parsed: parsed as Record<string, unknown>, error: null };
  } catch {
    return { parsed: null, error: "Schema JSON must be valid JSON." };
  }
}

export function resolveOpenAiTextSettings(rawSettings: Record<string, unknown> | undefined, modelId?: string | null) {
  const settings = rawSettings || {};
  const profile = getOpenAiTextModelProfile(modelId);
  const maxOutputTokens = readMaxOutputTokens(settings.maxOutputTokens, profile);
  const textOutputTarget = readOpenAiTextOutputTarget(settings.textOutputTarget, OPENAI_DEFAULT_TEXT_OUTPUT_TARGET);
  const verbosity = readVerbosity(settings.verbosity, profile.defaultVerbosity);
  const outputFormat = isStructuredTextOutputTarget(textOutputTarget)
    ? "json_schema"
    : readOutputFormat(settings.outputFormat, OPENAI_DEFAULT_TEXT_OUTPUT_FORMAT);
  const reasoningEffort = readReasoningEffort(settings.reasoningEffort, profile);
  const jsonSchemaName =
    textOutputTarget === "note" && outputFormat === "json_schema" ? readJsonSchemaName(settings.jsonSchemaName) : null;
  const jsonSchemaDefinition =
    textOutputTarget === "note" && outputFormat === "json_schema"
      ? readJsonSchemaDefinition(settings.jsonSchemaDefinition)
      : null;

  let validationError: string | null = null;
  let parsedJsonSchema: Record<string, unknown> | null = null;
  if (textOutputTarget === "note" && outputFormat === "json_schema") {
    if (!jsonSchemaName) {
      validationError = "Schema name is required for JSON Schema output.";
    } else if (!jsonSchemaNamePattern.test(jsonSchemaName)) {
      validationError = "Schema name must use letters, numbers, underscores, or dashes.";
    } else {
      const parsed = parseJsonSchemaDefinition(jsonSchemaDefinition);
      validationError = parsed.error;
      parsedJsonSchema = parsed.parsed;
    }
  }

  const effectiveSettings: Record<string, unknown> = {
    textOutputTarget,
    verbosity,
    outputFormat,
    reasoningEffort,
    ...(maxOutputTokens !== null ? { maxOutputTokens } : {}),
    ...(textOutputTarget === "note" && outputFormat === "json_schema"
      ? {
          jsonSchemaName: jsonSchemaName || "",
          jsonSchemaDefinition: jsonSchemaDefinition || "",
        }
      : {}),
  };

  return {
    maxOutputTokens,
    textOutputTarget,
    verbosity,
    outputFormat,
    reasoningEffort,
    jsonSchemaName,
    jsonSchemaDefinition,
    parsedJsonSchema,
    validationError,
    effectiveSettings,
  };
}

export function buildOpenAiTextRequestConfig(
  resolved: ReturnType<typeof resolveOpenAiTextSettings>
): { instructions?: string; text: { verbosity: OpenAiTextVerbosity; format: Record<string, unknown> } } {
  if (isStructuredTextOutputTarget(resolved.textOutputTarget)) {
    const contract = getStructuredTextOutputContract(resolved.textOutputTarget);
    return {
      instructions: contract.instructions,
      text: {
        verbosity: resolved.verbosity,
        format: {
          type: "json_schema",
          name: contract.schemaName,
          schema: contract.schema,
          strict: true,
        },
      },
    };
  }

  return {
    text: {
      verbosity: resolved.verbosity,
      format:
        resolved.outputFormat === "text"
          ? { type: "text" }
          : resolved.outputFormat === "json_object"
            ? { type: "json_object" }
            : {
                type: "json_schema",
                name: resolved.jsonSchemaName,
                schema: resolved.parsedJsonSchema,
                strict: true,
              },
    },
  };
}

export function buildOpenAiTextDebugRequest(input: {
  modelId: string;
  prompt: string;
  rawSettings: Record<string, unknown>;
}) {
  const resolved = resolveOpenAiTextSettings(input.rawSettings, input.modelId);
  const requestConfig = buildOpenAiTextRequestConfig(resolved);
  const request: Record<string, unknown> = {
    model: input.modelId,
    input: input.prompt,
    reasoning: {
      effort: resolved.reasoningEffort,
    },
    text: requestConfig.text,
  };

  if (resolved.maxOutputTokens !== null) {
    request.max_output_tokens = resolved.maxOutputTokens;
  }

  if (requestConfig.instructions) {
    request.instructions = requestConfig.instructions;
  }

  return {
    endpoint: "client.responses.create",
    request,
    effectiveSettings: resolved.effectiveSettings,
    validationError: resolved.validationError,
  };
}
