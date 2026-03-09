import { z } from "zod";
import type { ProviderId, WorkflowNode } from "@/components/workspace/types";
import { getSpawnableNodeCatalogSummaries } from "@/lib/node-catalog";
import {
  createGeneratedModelListSettings,
  createGeneratedModelTextNoteSettings,
  createGeneratedModelTextTemplateSettings,
  normalizeTemplateDisplayLabel,
} from "@/lib/list-template";
import type { OpenAiTextOutputTarget } from "@/lib/text-output-targets";

export type GeneratedNodeKind = "text-note" | "list" | "text-template";

type GeneratedNodeDescriptorBase = {
  kind: GeneratedNodeKind;
  label: string;
  sourceJobId: string;
  sourceModelNodeId: string;
  outputIndex: number;
  descriptorIndex: number;
};

export type GeneratedTextNoteDescriptor = GeneratedNodeDescriptorBase & {
  kind: "text-note";
  text: string;
};

export type GeneratedListNodeDescriptor = GeneratedNodeDescriptorBase & {
  kind: "list";
  columns: string[];
  rows: string[][];
};

export type GeneratedTextTemplateDescriptor = GeneratedNodeDescriptorBase & {
  kind: "text-template";
  templateText: string;
};

export type GeneratedNodeDescriptor =
  | GeneratedTextNoteDescriptor
  | GeneratedListNodeDescriptor
  | GeneratedTextTemplateDescriptor;

type StructuredParseInput = {
  textOutputTarget: OpenAiTextOutputTarget;
  content: string;
  sourceJobId: string;
  sourceModelNodeId: string;
  outputIndex?: number;
};

export type StructuredParseResult = {
  generatedNodeDescriptors: GeneratedNodeDescriptor[];
  warning: string | null;
};

type DescriptorSeed =
  | {
      kind: "text-note";
      label: string;
      text: string;
    }
  | {
      kind: "list";
      label: string;
      columns: string[];
      rows: string[][];
    }
  | {
      kind: "text-template";
      label: string;
      templateText: string;
    };

const textNoteDescriptorSchema = z.object({
  kind: z.literal("text-note"),
  label: z.string().trim().min(1).max(120),
  text: z.string(),
});

const listDescriptorSchema = z
  .object({
    kind: z.literal("list"),
    label: z.string().trim().min(1).max(120),
    columns: z.array(z.string().trim().min(1).max(120)).min(1),
    rows: z.array(z.array(z.string())),
  })
  .superRefine((value, ctx) => {
    value.rows.forEach((row, rowIndex) => {
      if (row.length !== value.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${rowIndex + 1} must contain exactly ${value.columns.length} value(s).`,
        });
      }
    });
  });

const textTemplateDescriptorSchema = z.object({
  kind: z.literal("text-template"),
  label: z.string().trim().min(1).max(120),
  templateText: z.string().min(1),
});

const smartOutputSchema = z.object({
  nodes: z.array(z.union([textNoteDescriptorSchema, listDescriptorSchema, textTemplateDescriptorSchema])).min(1),
});

const singleBracketPlaceholderPattern = /\[(?!\[)\s*([^[\]]+?)\s*\](?!\])/g;

function descriptorSeedToDescriptor(
  seed: DescriptorSeed,
  provenance: {
    sourceJobId: string;
    sourceModelNodeId: string;
    outputIndex: number;
    descriptorIndex: number;
  }
): GeneratedNodeDescriptor {
  if (seed.kind === "text-template") {
    return {
      ...seed,
      templateText: normalizeGeneratedTemplateText(seed.templateText),
      ...provenance,
    };
  }

  if (seed.kind === "list") {
    return {
      ...seed,
      ...provenance,
    };
  }

  return {
    ...seed,
    ...provenance,
  };
}

function normalizeGeneratedTemplateText(templateText: string) {
  return templateText.replace(singleBracketPlaceholderPattern, (_match, rawLabel: string) => {
    const label = normalizeTemplateDisplayLabel(String(rawLabel ?? ""));
    return label ? `[[${label}]]` : _match;
  });
}

function buildSmartOutputInstructions() {
  const summaries = getSpawnableNodeCatalogSummaries();
  const allowedKinds = summaries.map((summary) => summary.kind).join(", ");
  const generalRules = summaries.map((summary) => `${summary.kind}: ${summary.promptSummary}`).join(" ");
  const payloadRules = summaries.map((summary) => summary.payloadSummary).join(" ");

  return `Respond with JSON only. Generate the set of nodes that best fulfills the user's request. If the user gives specific instructions about what nodes to create, follow those instructions first. Apply the general rules below only when the user has not already made the desired node types clear. Allowed kinds are ${allowedKinds}. You may return one node or many. Create only the node types that are actually useful for the request. Do not force a list or template unless the user's request clearly calls for one. ${generalRules} You may return multiple nodes when the request naturally implies multiple useful outputs. Template rules: placeholder variables must use only [[variable]] syntax. Placeholders may appear in any order and may repeat any number of times. Do not use single-bracket placeholders like [variable]. Do not use mustache placeholders like {{variable}}. Do not use any other delimiter style for placeholder variables. Curly braces, single brackets, parentheses, quotes, and other punctuation may appear as literal text when they are not placeholder variables, so preserve them when they are meant literally. Before returning a text-template node, rewrite placeholder-like variable references into [[variable]] syntax while leaving literal punctuation unchanged. If you return both a list and a text-template that are meant to work together, every template placeholder must correspond to a list column, do not invent template placeholders that are not backed by the list, and make them compatible enough that the template can be filled from the list without missing variables. Every node must include kind, label, text, columns, rows, and templateText. For unused fields, set the value to null. ${payloadRules} Do not include explanations, markdown, commentary, or connections. Return only valid JSON that matches the schema.`;
}

export function getGeneratedDescriptorDefaultLabel(kind: GeneratedNodeKind, visualIndex = 0) {
  if (kind === "list") {
    return `Generated List ${visualIndex + 1}`;
  }
  if (kind === "text-template") {
    return `Generated Template ${visualIndex + 1}`;
  }
  return `Generated Text ${visualIndex + 1}`;
}

export function getStructuredTextOutputContract(target: Exclude<OpenAiTextOutputTarget, "note">) {
  if (target === "list") {
    return {
      schemaName: "generated_list_node",
      instructions:
        "Respond with JSON only. Generate exactly one list node. Provide a concise label, one or more column names, and rows whose value count exactly matches the number of columns.",
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
    } as const;
  }

  if (target === "template") {
    return {
      schemaName: "generated_template_node",
      instructions:
        "Respond with JSON only. Generate exactly one text template node. Provide a concise label and templateText that can be edited directly in the app.",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "text-template" },
          label: { type: "string" },
          templateText: { type: "string" },
        },
        required: ["kind", "label", "templateText"],
      },
    } as const;
  }

  return {
    schemaName: "generated_smart_nodes",
    instructions: buildSmartOutputInstructions(),
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
  } as const;
}

export function createFallbackGeneratedTextNoteDescriptor(input: {
  content: string;
  sourceJobId: string;
  sourceModelNodeId: string;
  outputIndex?: number;
  descriptorIndex?: number;
  label?: string;
}): GeneratedTextNoteDescriptor {
  return {
    kind: "text-note",
    label: input.label || getGeneratedDescriptorDefaultLabel("text-note", input.descriptorIndex || 0),
    text: input.content,
    sourceJobId: input.sourceJobId,
    sourceModelNodeId: input.sourceModelNodeId,
    outputIndex: input.outputIndex ?? 0,
    descriptorIndex: input.descriptorIndex ?? 0,
  };
}

export function parseStructuredTextOutput(input: StructuredParseInput): StructuredParseResult {
  const outputIndex = input.outputIndex ?? 0;

  try {
    const parsed = JSON.parse(input.content) as unknown;
    const seeds =
      input.textOutputTarget === "list"
        ? [listDescriptorSchema.parse(parsed)]
        : input.textOutputTarget === "template"
          ? [textTemplateDescriptorSchema.parse(parsed)]
          : smartOutputSchema.parse(parsed).nodes;

    return {
      generatedNodeDescriptors: seeds.map((seed, descriptorIndex) =>
        descriptorSeedToDescriptor(seed, {
          sourceJobId: input.sourceJobId,
          sourceModelNodeId: input.sourceModelNodeId,
          outputIndex,
          descriptorIndex,
        })
      ),
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown structured output parse failure.";
    return {
      generatedNodeDescriptors: [
        createFallbackGeneratedTextNoteDescriptor({
          content: input.content,
          sourceJobId: input.sourceJobId,
          sourceModelNodeId: input.sourceModelNodeId,
          outputIndex,
        }),
      ],
      warning: `Structured output parsing failed. Fell back to a generated text note. ${message}`,
    };
  }
}

export function createGeneratedTextNoteDescriptorsFromRawText(input: {
  outputs: Array<{ content: string; outputIndex: number }>;
  sourceJobId: string;
  sourceModelNodeId: string;
}): GeneratedNodeDescriptor[] {
  return input.outputs.map((output, descriptorIndex) =>
    createFallbackGeneratedTextNoteDescriptor({
      content: output.content,
      sourceJobId: input.sourceJobId,
      sourceModelNodeId: input.sourceModelNodeId,
      outputIndex: output.outputIndex,
      descriptorIndex,
    })
  );
}

export function getGeneratedNodeDescriptorKey(input: {
  sourceJobId: string;
  outputIndex: number;
  descriptorIndex: number;
}) {
  return `${input.sourceJobId}:${input.outputIndex}:${input.descriptorIndex}`;
}

function getDeterministicListColumnId(descriptor: GeneratedListNodeDescriptor, columnIndex: number) {
  return `generated-col-${descriptor.outputIndex}-${descriptor.descriptorIndex}-${columnIndex}`;
}

function getDeterministicListRowId(descriptor: GeneratedListNodeDescriptor, rowIndex: number) {
  return `generated-row-${descriptor.outputIndex}-${descriptor.descriptorIndex}-${rowIndex}`;
}

export function buildGeneratedNodePosition(input: {
  modelNode: Pick<WorkflowNode, "x" | "y">;
  visualIndex: number;
  baseOffsetX: number;
  offsetY: number;
  columnOffsetX?: number;
}) {
  return {
    x: Math.round(input.modelNode.x + input.baseOffsetX + Math.floor(input.visualIndex / 4) * (input.columnOffsetX ?? 0)),
    y: Math.round(input.modelNode.y + (input.visualIndex % 4) * input.offsetY),
  };
}

type CreateGeneratedModelNodeInput = {
  id: string;
  providerId: ProviderId;
  modelId: string;
  modelNodeId: string;
  label: string;
  position: { x: number; y: number };
  processingState: WorkflowNode["processingState"];
  descriptor: GeneratedNodeDescriptor;
  connectToSourceModel?: boolean;
};

export function createGeneratedModelNode(input: CreateGeneratedModelNodeInput): WorkflowNode {
  const connectToSourceModel = input.connectToSourceModel !== false;
  const shared = {
    id: input.id,
    label: input.label,
    providerId: input.providerId,
    modelId: input.modelId,
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: input.descriptor.sourceJobId,
    sourceOutputIndex: input.descriptor.outputIndex,
    processingState: input.processingState,
    promptSourceNodeId: null,
    upstreamNodeIds: connectToSourceModel ? [input.modelNodeId] : [],
    upstreamAssetIds: connectToSourceModel ? [`node:${input.modelNodeId}`] : [],
    x: input.position.x,
    y: input.position.y,
    displayMode: "preview" as const,
    size: null,
  } satisfies Omit<
    WorkflowNode,
    "kind" | "nodeType" | "outputType" | "prompt" | "settings"
  >;

  if (input.descriptor.kind === "list") {
    return {
      ...shared,
      kind: "list",
      nodeType: "list",
      outputType: "text",
      prompt: "",
      settings: createGeneratedModelListSettings({
        sourceJobId: input.descriptor.sourceJobId,
        sourceModelNodeId: input.descriptor.sourceModelNodeId,
        outputIndex: input.descriptor.outputIndex,
        descriptorIndex: input.descriptor.descriptorIndex,
        columns: input.descriptor.columns.map((label, columnIndex) => ({
          id: getDeterministicListColumnId(input.descriptor, columnIndex),
          label,
        })),
        rows: input.descriptor.rows.map((row, rowIndex) => ({
          id: getDeterministicListRowId(input.descriptor, rowIndex),
          values: input.descriptor.columns.reduce<Record<string, string>>((acc, _column, columnIndex) => {
            acc[getDeterministicListColumnId(input.descriptor, columnIndex)] = row[columnIndex] ?? "";
            return acc;
          }, {}),
        })),
      }),
    };
  }

  if (input.descriptor.kind === "text-template") {
    return {
      ...shared,
      kind: "text-template",
      nodeType: "text-template",
      outputType: "text",
      prompt: input.descriptor.templateText,
      settings: createGeneratedModelTextTemplateSettings({
        sourceJobId: input.descriptor.sourceJobId,
        sourceModelNodeId: input.descriptor.sourceModelNodeId,
        outputIndex: input.descriptor.outputIndex,
        descriptorIndex: input.descriptor.descriptorIndex,
      }),
    };
  }

  return {
    ...shared,
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    prompt: input.descriptor.text,
    settings: createGeneratedModelTextNoteSettings({
      sourceJobId: input.descriptor.sourceJobId,
      sourceModelNodeId: input.descriptor.sourceModelNodeId,
      outputIndex: input.descriptor.outputIndex,
      descriptorIndex: input.descriptor.descriptorIndex,
    }),
  };
}

export function applyGeneratedDescriptorToNode(
  node: WorkflowNode,
  input: {
    providerId: ProviderId;
    modelId: string;
    processingState: WorkflowNode["processingState"];
    descriptor: GeneratedNodeDescriptor;
    allowContentHydration: boolean;
    connectToSourceModel?: boolean;
  }
): WorkflowNode {
  const nextNode = createGeneratedModelNode({
    id: node.id,
    providerId: input.providerId,
    modelId: input.modelId,
    modelNodeId: input.descriptor.sourceModelNodeId,
    label: input.descriptor.label || node.label,
    position: {
      x: node.x,
      y: node.y,
    },
    processingState: input.processingState,
    descriptor: input.descriptor,
    connectToSourceModel: input.connectToSourceModel,
  });
  const shouldPreserveGraphLinks = nextNode.kind === node.kind;
  const preservedGraphFields = shouldPreserveGraphLinks
    ? {
        promptSourceNodeId: node.promptSourceNodeId,
        upstreamNodeIds: node.upstreamNodeIds,
        upstreamAssetIds: node.upstreamAssetIds,
      }
    : null;

  if (!input.allowContentHydration) {
    return {
      ...nextNode,
      ...(preservedGraphFields || {}),
      label: node.label,
      prompt: node.prompt,
      settings:
        nextNode.kind === "list" && node.kind === "list"
          ? node.settings
          : nextNode.kind === "text-template" && node.kind === "text-template"
            ? node.settings
            : nextNode.kind === "text-note" && node.kind === "text-note"
              ? node.settings
              : nextNode.settings,
      processingState: input.processingState,
    };
  }

  return {
    ...nextNode,
    ...(preservedGraphFields || {}),
  };
}
