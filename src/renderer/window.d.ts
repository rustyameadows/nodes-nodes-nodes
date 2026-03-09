import type { NodeInterface } from "@/lib/ipc-contract";

declare global {
  interface Window {
    nodeInterface: NodeInterface;
  }
}

export {};
