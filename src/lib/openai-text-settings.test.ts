import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_TEXT_MAX_OUTPUT_TOKENS,
  buildOpenAiTextDebugRequest,
  getOpenAiTextDefaultSettings,
  getOpenAiTextParameterDefinitions,
  isRunnableOpenAiTextModel,
  resolveOpenAiTextSettings,
} from "./openai-text-settings";

test("recognizes runnable OpenAI text models", () => {
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5.4"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5-mini"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-5-nano"), true);
  assert.equal(isRunnableOpenAiTextModel("openai", "gpt-image-1.5"), false);
  assert.equal(isRunnableOpenAiTextModel("topaz", "gpt-5.4"), false);
});

test("exposes model-specific reasoning controls", () => {
  const gpt54ReasoningOptions = getOpenAiTextParameterDefinitions("gpt-5.4")
    .find((definition) => definition.key === "reasoningEffort")
    ?.options?.map((option) => option.value);
  const gpt5MiniReasoningOptions = getOpenAiTextParameterDefinitions("gpt-5-mini")
    .find((definition) => definition.key === "reasoningEffort")
    ?.options?.map((option) => option.value);

  assert.deepEqual(gpt54ReasoningOptions, ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(gpt5MiniReasoningOptions, ["minimal", "low", "medium", "high"]);
});

test("resolves defaults and prunes unsupported reasoning values on model switch", () => {
  assert.deepEqual(getOpenAiTextDefaultSettings("gpt-5.4"), {
    maxOutputTokens: null,
    textOutputTarget: "note",
    verbosity: "medium",
    outputFormat: "text",
    reasoningEffort: "none",
    jsonSchemaName: "",
    jsonSchemaDefinition: "",
  });

  const switched = resolveOpenAiTextSettings(
    {
      maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS + 500,
      verbosity: "high",
      outputFormat: "text",
      reasoningEffort: "xhigh",
      jsonSchemaName: "stale_schema",
      jsonSchemaDefinition: '{"type":"object"}',
    },
    "gpt-5-mini"
  );

  assert.equal(switched.maxOutputTokens, OPENAI_TEXT_MAX_OUTPUT_TOKENS);
  assert.equal(switched.reasoningEffort, "minimal");
  assert.deepEqual(switched.effectiveSettings, {
    maxOutputTokens: OPENAI_TEXT_MAX_OUTPUT_TOKENS,
    textOutputTarget: "note",
    verbosity: "high",
    outputFormat: "text",
    reasoningEffort: "minimal",
  });
});

test("validates JSON schema output settings", () => {
  const missingSchemaName = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaDefinition: '{"type":"object"}',
    },
    "gpt-5.4"
  );
  assert.equal(missingSchemaName.validationError, "Schema name is required for JSON Schema output.");

  const invalidSchemaJson = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaName: "prompt_output",
      jsonSchemaDefinition: "{bad json}",
    },
    "gpt-5.4"
  );
  assert.equal(invalidSchemaJson.validationError, "Schema JSON must be valid JSON.");

  const validSchema = resolveOpenAiTextSettings(
    {
      outputFormat: "json_schema",
      jsonSchemaName: "prompt_output",
      jsonSchemaDefinition: '{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"]}',
    },
    "gpt-5.4"
  );
  assert.equal(validSchema.validationError, null);
  assert.deepEqual(validSchema.parsedJsonSchema, {
    type: "object",
    properties: {
      prompt: {
        type: "string",
      },
    },
    required: ["prompt"],
  });
});

test("builds a Responses API preview request from resolved text settings", () => {
  const debugRequest = buildOpenAiTextDebugRequest({
    modelId: "gpt-5.4",
    prompt: "Return a JSON object with one image prompt.",
    rawSettings: {
      maxOutputTokens: 2048,
      textOutputTarget: "note",
      verbosity: "low",
      outputFormat: "json_object",
      reasoningEffort: "high",
    },
  });

  assert.equal(debugRequest.endpoint, "client.responses.create");
  assert.equal(debugRequest.validationError, null);
  assert.deepEqual(debugRequest.request, {
    model: "gpt-5.4",
    input: "Return a JSON object with one image prompt.",
    reasoning: {
      effort: "high",
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_object",
      },
    },
    max_output_tokens: 2048,
  });
});

test("forces structured JSON schema output for list targets", () => {
  const resolved = resolveOpenAiTextSettings(
    {
      textOutputTarget: "list",
      outputFormat: "text",
      reasoningEffort: "medium",
    },
    "gpt-5.4"
  );

  assert.equal(resolved.textOutputTarget, "list");
  assert.equal(resolved.outputFormat, "json_schema");
  assert.equal(resolved.validationError, null);
  assert.deepEqual(resolved.effectiveSettings, {
    textOutputTarget: "list",
    verbosity: "medium",
    outputFormat: "json_schema",
    reasoningEffort: "medium",
  });

  const debugRequest = buildOpenAiTextDebugRequest({
    modelId: "gpt-5.4",
    prompt: "Return a southwest city list.",
    rawSettings: {
      textOutputTarget: "list",
      outputFormat: "text",
    },
  });

  assert.equal(typeof debugRequest.request.instructions, "string");
  assert.deepEqual(debugRequest.request.text, {
    verbosity: "medium",
    format: {
      type: "json_schema",
      name: "generated_list_node",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "list" },
          label: { type: "string" },
          columns: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        required: ["kind", "label", "columns", "rows"],
      },
      strict: true,
    },
  });
});

test("builds smart output requests without oneOf in the JSON schema", () => {
  const debugRequest = buildOpenAiTextDebugRequest({
    modelId: "gpt-5.4",
    prompt: "Make a note, a list, and a template.",
    rawSettings: {
      textOutputTarget: "smart",
    },
  });

  assert.equal(typeof debugRequest.request.instructions, "string");
  assert.match(
    String(debugRequest.request.instructions),
    /If the user gives specific instructions about what nodes to create, follow those instructions first\./
  );
  assert.match(String(debugRequest.request.instructions), /placeholders may appear in any order/i);
  assert.match(String(debugRequest.request.instructions), /do not use mustache placeholders like \{\{variable\}\}/i);
  assert.match(
    String(debugRequest.request.instructions),
    /Curly braces, single brackets, parentheses, quotes, and other punctuation may appear as literal text/i
  );
  assert.deepEqual(debugRequest.request.text, {
    verbosity: "medium",
    format: {
      type: "json_schema",
      name: "generated_smart_nodes",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          nodes: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: ["text-note", "list", "text-template"],
                },
                label: { type: "string" },
                text: { type: ["string", "null"] },
                columns: {
                  type: ["array", "null"],
                  items: { type: "string" },
                },
                rows: {
                  type: ["array", "null"],
                  items: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                templateText: { type: ["string", "null"] },
              },
              required: ["kind", "label", "text", "columns", "rows", "templateText"],
            },
          },
        },
        required: ["nodes"],
      },
      strict: true,
    },
  });
});
