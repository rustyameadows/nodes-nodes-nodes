import type { WorkflowNodeDisplayMode } from "@/components/workspace/types";
import type {
  CanvasNodeInteractionPolicy,
  CanvasNodeRenderMode,
} from "@/lib/canvas-node-presentation";

export type CanvasNodeActionId =
  | "default"
  | "compact"
  | "edit"
  | "run"
  | "open"
  | "download"
  | "debug";

export type CanvasNodeActionTone = "neutral" | "accent";

export type CanvasNodeActionDescriptor = {
  id: CanvasNodeActionId;
  label: string;
  tone: CanvasNodeActionTone;
  disabled?: boolean;
};

type Input = {
  interactionPolicy: CanvasNodeInteractionPolicy;
  persistedMode: WorkflowNodeDisplayMode;
  renderMode: CanvasNodeRenderMode;
  isEditing: boolean;
  canRun?: boolean;
  hasAsset?: boolean;
  hasDebug?: boolean;
};

function getModeActionDescriptors(
  persistedMode: WorkflowNodeDisplayMode,
  renderMode: CanvasNodeRenderMode
) {
  const actions: CanvasNodeActionDescriptor[] = [];

  if (persistedMode !== "preview" || renderMode === "resized") {
    actions.push({
      id: "default",
      label: "Default",
      tone: "neutral",
    });
  }

  if (persistedMode !== "compact") {
    actions.push({
      id: "compact",
      label: "Compact",
      tone: "neutral",
    });
  }

  return actions;
}

export function getCanvasNodeActionDescriptors(input: Input): CanvasNodeActionDescriptor[] {
  if (input.interactionPolicy === "image-asset" || input.interactionPolicy === "asset") {
    return [
      ...(input.hasAsset
        ? [
            {
              id: "open",
              label: "Open",
              tone: "neutral",
            } satisfies CanvasNodeActionDescriptor,
            {
              id: "download",
              label: "Download",
              tone: "neutral",
            } satisfies CanvasNodeActionDescriptor,
          ]
        : []),
      ...(input.hasDebug
        ? [
            {
              id: "debug",
              label: "Debug",
              tone: "neutral",
            } satisfies CanvasNodeActionDescriptor,
          ]
        : []),
    ];
  }

  if (input.interactionPolicy === "text-template") {
    return [
      ...(input.isEditing
        ? []
        : [
            {
              id: "edit",
              label: "Edit",
              tone: "neutral",
            } satisfies CanvasNodeActionDescriptor,
          ]),
      {
        id: "run",
        label: "Run",
        tone: input.canRun ? "accent" : "neutral",
        disabled: !input.canRun,
      },
      ...getModeActionDescriptors(input.persistedMode, input.renderMode),
    ];
  }

  if (input.interactionPolicy === "model") {
    return getModeActionDescriptors(input.persistedMode, input.renderMode);
  }

  return getModeActionDescriptors(input.persistedMode, input.renderMode);
}
