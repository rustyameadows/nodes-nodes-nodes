import type { MenuCommand } from "@/lib/ipc-contract";

export type CanvasMenuCommand = Extract<
  MenuCommand,
  | { type: "canvas.open-insert-menu" }
  | { type: "canvas.connect-selected" }
  | { type: "canvas.duplicate-selected" }
  | { type: "canvas.delete-selection" }
  | { type: "canvas.open-primary-editor" }
  | { type: "canvas.undo" }
  | { type: "canvas.redo" }
  | { type: "canvas.add-node" }
>;

const listeners = new Set<(command: CanvasMenuCommand) => void>();

export function publishCanvasMenuCommand(command: CanvasMenuCommand) {
  for (const listener of listeners) {
    listener(command);
  }
}

export function subscribeToCanvasMenuCommand(listener: (command: CanvasMenuCommand) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
