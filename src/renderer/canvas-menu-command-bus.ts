import type { MenuCommand } from "@/lib/ipc-contract";

export type CanvasMenuCommand = Extract<MenuCommand, { type: "canvas.add-node" }>;

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
