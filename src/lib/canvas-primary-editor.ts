import type { WorkflowNode } from "@/components/workspace/types";

export type CanvasBottomBarPopoverId =
  | "provider"
  | "model"
  | "prompt"
  | "advanced"
  | "details"
  | "api"
  | "list"
  | "template"
  | "template-details"
  | "note"
  | "note-links"
  | "asset-details"
  | "source-call";

type ResolvePrimaryCanvasEditorOptions = {
  hasSourceJob: boolean;
};

export function resolvePrimaryCanvasEditorId(
  node: Pick<WorkflowNode, "kind"> | null,
  options: ResolvePrimaryCanvasEditorOptions
): CanvasBottomBarPopoverId | null {
  if (!node) {
    return null;
  }

  if (options.hasSourceJob) {
    return "source-call";
  }

  if (node.kind === "model") {
    return "prompt";
  }

  if (node.kind === "text-note") {
    return "note";
  }

  if (node.kind === "list") {
    return "list";
  }

  if (node.kind === "text-template") {
    return "template";
  }

  if (node.kind === "asset-source") {
    return "asset-details";
  }

  return null;
}
