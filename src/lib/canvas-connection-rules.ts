import type { WorkflowNode } from "@/components/workspace/types";
import { getGeneratedModelTextNoteSettings, getGeneratedTextNoteSettings } from "@/lib/list-template";
import { isRunnableTextModel } from "@/lib/provider-model-helpers";

export function canConnectCanvasNodes(sourceNode: WorkflowNode | null | undefined, targetNode: WorkflowNode | null | undefined) {
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
    return false;
  }

  if (targetNode.kind === "list") {
    return false;
  }

  if (targetNode.kind === "text-note") {
    const generatedModelTextSettings = getGeneratedModelTextNoteSettings(targetNode.settings);
    const generatedTemplateTextSettings = getGeneratedTextNoteSettings(targetNode.settings);
    return (
      Boolean(generatedModelTextSettings || generatedTemplateTextSettings) &&
      (sourceNode.kind === "model" || sourceNode.kind === "text-template")
    );
  }

  if (sourceNode.kind === "text-note" || sourceNode.kind === "reference") {
    return targetNode.kind === "model";
  }

  if (targetNode.kind === "model" && isRunnableTextModel(targetNode.providerId, targetNode.modelId)) {
    return false;
  }

  if (sourceNode.kind === "list") {
    return targetNode.kind === "text-template";
  }

  if (targetNode.kind === "text-template" || sourceNode.kind === "text-template") {
    return false;
  }

  if (sourceNode.kind === "model" && isRunnableTextModel(sourceNode.providerId, sourceNode.modelId)) {
    return false;
  }

  return true;
}
