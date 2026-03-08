type CanvasMenuState = {
  selectedNodeCount: number;
  canConnectSelected: boolean;
  canDuplicateSelected: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const defaultCanvasMenuState: CanvasMenuState = {
  selectedNodeCount: 0,
  canConnectSelected: false,
  canDuplicateSelected: false,
  canUndo: false,
  canRedo: false,
};

let currentCanvasMenuState = defaultCanvasMenuState;
const listeners = new Set<(state: CanvasMenuState) => void>();

export function publishCanvasMenuState(nextState: CanvasMenuState) {
  currentCanvasMenuState = nextState;
  for (const listener of listeners) {
    listener(nextState);
  }
}

export function resetCanvasMenuState() {
  publishCanvasMenuState(defaultCanvasMenuState);
}

export function subscribeToCanvasMenuState(listener: (state: CanvasMenuState) => void) {
  listeners.add(listener);
  listener(currentCanvasMenuState);
  return () => {
    listeners.delete(listener);
  };
}
