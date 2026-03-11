import type { WorkflowNode } from "@/components/workspace/types";

type PromptSourcePreviewNode = Pick<WorkflowNode, "label" | "prompt">;

export type ModelPromptSurfaceState = {
  title: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  isConnectedPreview: boolean;
};

export function getModelPromptSurfaceState({
  prompt,
  promptSourceNode,
}: {
  prompt: string;
  promptSourceNode: PromptSourcePreviewNode | null | undefined;
}): ModelPromptSurfaceState {
  if (!promptSourceNode) {
    return {
      title: "Prompt",
      value: prompt,
      placeholder: "Describe what to generate",
      readOnly: false,
      isConnectedPreview: false,
    };
  }

  const sourceLabel = promptSourceNode.label.trim() || "Connected note";
  const sourcePrompt = promptSourceNode.prompt.trim();

  return {
    title: `Prompt from ${sourceLabel}`,
    value: promptSourceNode.prompt,
    placeholder: sourcePrompt.length > 0 ? "Describe what to generate" : "Connected note is empty",
    readOnly: true,
    isConnectedPreview: true,
  };
}
