import type { WorkflowNodeDisplayMode } from "@/components/workspace/types";
import type {
  CanvasNodeInteractionPolicy,
  CanvasNodeRenderMode,
} from "@/lib/canvas-node-presentation";

export type CanvasNodeActionId =
  | "default"
  | "compact"
  | "add-column"
  | "duplicate"
  | "edit"
  | "run"
  | "open"
  | "download"
  | "debug";

export type CanvasNodeActionTone = "neutral" | "accent";
export type CanvasNodeActionSlot = "top-left" | "bottom";

export type CanvasNodeActionDescriptor = {
  id: CanvasNodeActionId;
  label: string;
  tone: CanvasNodeActionTone;
  slot: CanvasNodeActionSlot;
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

  if (persistedMode !== "preview" || renderMode === "full" || renderMode === "resized") {
    actions.push({
      id: "default",
      label: "Default",
      tone: "neutral",
      slot: "top-left",
    });
  }

  if (persistedMode !== "compact" || renderMode === "full" || renderMode === "resized") {
    actions.push({
      id: "compact",
      label: "Compact",
      tone: "neutral",
      slot: "top-left",
    });
  }

  return actions;
}

export function getCanvasNodeActionDescriptors(input: Input): CanvasNodeActionDescriptor[] {
  if (input.interactionPolicy === "image-asset" || input.interactionPolicy === "asset") {
    return [
      ...getModeActionDescriptors(input.persistedMode, input.renderMode),
      ...(input.hasAsset
        ? [
            {
              id: "open",
              label: "Open",
              tone: "neutral",
              slot: "bottom",
            } satisfies CanvasNodeActionDescriptor,
            {
              id: "download",
              label: "Download",
              tone: "neutral",
              slot: "bottom",
            } satisfies CanvasNodeActionDescriptor,
          ]
        : []),
      ...(input.hasDebug
        ? [
            {
              id: "debug",
              label: "Debug",
              tone: "neutral",
              slot: "bottom",
            } satisfies CanvasNodeActionDescriptor,
          ]
        : []),
    ];
  }

  if (input.interactionPolicy === "text-template") {
    return [
      ...getModeActionDescriptors(input.persistedMode, input.renderMode),
      ...(input.isEditing
        ? []
        : [
            {
              id: "edit",
              label: "Edit",
              tone: "neutral",
              slot: "bottom",
            } satisfies CanvasNodeActionDescriptor,
          ]),
      {
        id: "run",
        label: "Run",
        tone: input.canRun ? "accent" : "neutral",
        slot: "bottom",
        disabled: !input.canRun,
      },
    ];
  }

  if (input.interactionPolicy === "model") {
    return [
      ...getModeActionDescriptors(input.persistedMode, input.renderMode),
      {
        id: "duplicate",
        label: "Duplicate",
        tone: "neutral",
        slot: "bottom",
      },
    ];
  }

  if (input.interactionPolicy === "list") {
    return [
      ...getModeActionDescriptors(input.persistedMode, input.renderMode),
      {
        id: "add-column",
        label: "Add column",
        tone: "neutral",
        slot: "bottom",
      },
    ];
  }

  return getModeActionDescriptors(input.persistedMode, input.renderMode);
}
