import type { JobRunOrigin } from "@/components/workspace/types";
import {
  createGeneratedTextNoteDescriptorsFromRawText,
  parseStructuredTextOutput,
  type GeneratedConnectionDescriptor,
  type GeneratedNodeDescriptor,
} from "@/lib/generated-text-output";
import { readGeminiMixedOutputDiagnostics, type GeminiMixedOutputDiagnostics } from "@/lib/gemini-mixed-output";
import { readOpenAiTextOutputTarget } from "@/lib/text-output-targets";

export type JobAttemptTextOutput = {
  outputIndex: number;
  content: string;
  responseId: string | null;
  textOutputTarget: ReturnType<typeof readOpenAiTextOutputTarget>;
};

type GeneratedOutputData = {
  generatedNodeDescriptors: GeneratedNodeDescriptor[];
  generatedConnections: GeneratedConnectionDescriptor[];
  warning: string | null;
};

function normalizeGeneratedNodeDescriptors(
  rawDescriptors: unknown[],
  sourceJobId: string,
  sourceModelNodeId: string | null | undefined,
  runOrigin: JobRunOrigin
): GeneratedNodeDescriptor[] {
  return rawDescriptors
    .map((descriptor, descriptorIndex) => {
      if (!descriptor || typeof descriptor !== "object") {
        return null;
      }

      const record = descriptor as Record<string, unknown>;
      const kind = record.kind;
      const outputIndex = typeof record.outputIndex === "number" ? Number(record.outputIndex) : 0;
      const normalizedSourceModelNodeId =
        typeof record.sourceModelNodeId === "string" ? String(record.sourceModelNodeId) : sourceModelNodeId ?? null;
      const normalizedRunOrigin =
        record.runOrigin === "copilot" || record.runOrigin === "canvas-node"
          ? record.runOrigin
          : normalizedSourceModelNodeId
            ? "canvas-node"
            : runOrigin;
      const shared = {
        descriptorId:
          typeof record.descriptorId === "string" && record.descriptorId.trim()
            ? String(record.descriptorId)
            : `generated-${outputIndex}-${descriptorIndex}`,
        label:
          typeof record.label === "string" && record.label.trim()
            ? String(record.label)
            : `Generated ${descriptorIndex + 1}`,
        sourceJobId: typeof record.sourceJobId === "string" ? String(record.sourceJobId) : sourceJobId,
        sourceModelNodeId: normalizedSourceModelNodeId,
        outputIndex,
        descriptorIndex:
          typeof record.descriptorIndex === "number" ? Number(record.descriptorIndex) : descriptorIndex,
        runOrigin: normalizedRunOrigin,
      } as const;

      if (kind === "list" && Array.isArray(record.columns) && Array.isArray(record.rows)) {
        return {
          ...shared,
          kind: "list" as const,
          columns: record.columns.map((value) => String(value)),
          rows: record.rows.map((row) => (Array.isArray(row) ? row.map((value) => String(value)) : [])),
        };
      }

      if (kind === "text-template" && typeof record.templateText === "string") {
        return {
          ...shared,
          kind: "text-template" as const,
          templateText: String(record.templateText),
        };
      }

      if (kind === "text-note" && typeof record.text === "string") {
        return {
          ...shared,
          kind: "text-note" as const,
          text: String(record.text),
        };
      }

      return null;
    })
    .filter((descriptor): descriptor is GeneratedNodeDescriptor => Boolean(descriptor));
}

function getGeneratedConnections(
  providerResponse: Record<string, unknown> | null | undefined
): GeneratedConnectionDescriptor[] {
  if (!providerResponse || typeof providerResponse !== "object" || !Array.isArray(providerResponse.generatedConnections)) {
    return [];
  }

  return providerResponse.generatedConnections
    .map((connection) => (connection && typeof connection === "object" ? (connection as Record<string, unknown>) : null))
    .filter((connection): connection is Record<string, unknown> => Boolean(connection))
    .map((connection) => {
      if (
        (connection.kind !== "input" && connection.kind !== "prompt") ||
        typeof connection.sourceDescriptorId !== "string" ||
        typeof connection.targetDescriptorId !== "string"
      ) {
        return null;
      }

      return {
        kind: connection.kind,
        sourceDescriptorId: connection.sourceDescriptorId,
        targetDescriptorId: connection.targetDescriptorId,
      } satisfies GeneratedConnectionDescriptor;
    })
    .filter((connection): connection is GeneratedConnectionDescriptor => Boolean(connection));
}

export function getLatestTextOutputs(providerResponse: Record<string, unknown> | null | undefined) {
  if (!providerResponse || typeof providerResponse !== "object") {
    return [];
  }

  const outputs = Array.isArray(providerResponse.outputs) ? providerResponse.outputs : [];

  return outputs
    .map((output) => (output && typeof output === "object" ? (output as Record<string, unknown>) : null))
    .filter((output): output is Record<string, unknown> => Boolean(output))
    .filter((output) => output.type === "text" && typeof output.content === "string")
    .map((output, index) => {
      const metadata =
        output.metadata && typeof output.metadata === "object"
          ? (output.metadata as Record<string, unknown>)
          : {};
      return {
        outputIndex:
          typeof metadata.outputIndex === "number"
            ? Number(metadata.outputIndex)
            : typeof output.outputIndex === "number"
              ? Number(output.outputIndex)
              : index,
        content: String(output.content),
        responseId: metadata.responseId ? String(metadata.responseId) : null,
        textOutputTarget: readOpenAiTextOutputTarget(metadata.textOutputTarget),
      } satisfies JobAttemptTextOutput;
    });
}

export function getStoredTextOutputTarget(
  providerResponse: Record<string, unknown> | null | undefined,
  fallback: unknown
) {
  const fallbackTarget = readOpenAiTextOutputTarget(fallback);
  if (providerResponse && typeof providerResponse === "object" && "textOutputTarget" in providerResponse) {
    return readOpenAiTextOutputTarget(
      (providerResponse as Record<string, unknown>).textOutputTarget,
      fallbackTarget
    );
  }

  const outputTarget = getLatestTextOutputs(providerResponse)[0]?.textOutputTarget;
  return readOpenAiTextOutputTarget(outputTarget, fallbackTarget);
}

export function getGeneratedOutputData(input: {
  providerResponse: Record<string, unknown> | null | undefined;
  sourceJobId: string;
  sourceModelNodeId: string | null | undefined;
  runOrigin: JobRunOrigin;
}): GeneratedOutputData {
  const { providerResponse, sourceJobId, sourceModelNodeId, runOrigin } = input;
  if (!providerResponse || typeof providerResponse !== "object") {
    return {
      generatedNodeDescriptors: [],
      generatedConnections: [],
      warning: null,
    };
  }

  if (Array.isArray(providerResponse.generatedNodeDescriptors)) {
    return {
      generatedNodeDescriptors: normalizeGeneratedNodeDescriptors(
        providerResponse.generatedNodeDescriptors,
        sourceJobId,
        sourceModelNodeId,
        runOrigin
      ),
      generatedConnections: getGeneratedConnections(providerResponse),
      warning:
        typeof providerResponse.generatedNodeDescriptorWarning === "string"
          ? providerResponse.generatedNodeDescriptorWarning
          : null,
    };
  }

  const textOutputs = getLatestTextOutputs(providerResponse);
  if (textOutputs.length === 0) {
    return {
      generatedNodeDescriptors: [],
      generatedConnections: [],
      warning: null,
    };
  }

  const textOutputTarget = getStoredTextOutputTarget(providerResponse, textOutputs[0]?.textOutputTarget);
  if (textOutputTarget === "note") {
    return {
      generatedNodeDescriptors: createGeneratedTextNoteDescriptorsFromRawText({
        outputs: textOutputs.map((output) => ({
          content: output.content,
          outputIndex: output.outputIndex,
        })),
        sourceJobId,
        sourceModelNodeId,
        runOrigin,
      }),
      generatedConnections: [],
      warning: null,
    };
  }

  if (!textOutputTarget || textOutputs.length === 0) {
    return {
      generatedNodeDescriptors: [],
      generatedConnections: [],
      warning: null,
    };
  }

  return parseStructuredTextOutput({
    textOutputTarget,
    content: textOutputs[0]!.content,
    sourceJobId,
    sourceModelNodeId,
    outputIndex: textOutputs[0]!.outputIndex,
    runOrigin,
  });
}

export function getGeminiMixedOutputDiagnostics(
  providerResponse: Record<string, unknown> | null | undefined
): GeminiMixedOutputDiagnostics | null {
  if (!providerResponse || typeof providerResponse !== "object") {
    return null;
  }

  const topLevelDiagnostics = readGeminiMixedOutputDiagnostics(
    (providerResponse as Record<string, unknown>).mixedOutputDiagnostics
  );
  if (topLevelDiagnostics) {
    return topLevelDiagnostics;
  }

  const outputs = Array.isArray(providerResponse.outputs) ? providerResponse.outputs : [];
  for (const output of outputs) {
    if (!output || typeof output !== "object") {
      continue;
    }

    const metadata =
      "metadata" in output && output.metadata && typeof output.metadata === "object"
        ? (output.metadata as Record<string, unknown>)
        : null;
    const diagnostics = readGeminiMixedOutputDiagnostics(metadata?.geminiMixedOutputDiagnostics);
    if (diagnostics) {
      return diagnostics;
    }
  }

  return null;
}
