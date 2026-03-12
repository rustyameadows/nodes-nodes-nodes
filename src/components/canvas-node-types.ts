import type {
  CanvasConnectionSelection,
  WorkflowNode,
  WorkflowNodeSize,
} from "@/components/workspace/types";
import type {
  CanvasNodeRenderMode,
  ResolvedCanvasNodePresentation,
} from "@/lib/canvas-node-presentation";

export type CanvasAccentType = CanvasConnectionSelection["semanticType"] | "failed";
export type CanvasNodeGeneratedProvenance = "model" | "operator";

export type CanvasRenderNode = Pick<
  WorkflowNode,
  | "id"
  | "label"
  | "kind"
  | "providerId"
  | "modelId"
  | "nodeType"
  | "outputType"
  | "prompt"
  | "settings"
  | "sourceAssetId"
  | "sourceAssetMimeType"
  | "sourceJobId"
  | "sourceOutputIndex"
  | "processingState"
  | "promptSourceNodeId"
  | "upstreamNodeIds"
  | "upstreamAssetIds"
  | "x"
  | "y"
  | "zIndex"
  | "displayMode"
  | "size"
> & {
  assetOrigin?: "generated" | "uploaded" | null;
  sourceModelNodeId?: string | null;
  generatedProvenance?: CanvasNodeGeneratedProvenance | null;
  displayModelName?: string | null;
  displaySourceLabel?: string | null;
  inputSemanticTypes?: CanvasAccentType[];
  outputSemanticType?: CanvasAccentType;
  previewImageUrl?: string | null;
  hasStartedJob?: boolean;
  listPreviewColumns?: string[];
  listPreviewRows?: string[][];
  listRowCount?: number;
  listColumnCount?: number;
  templateRegisteredColumnCount?: number;
  templateUnresolvedCount?: number;
  templateReady?: boolean;
  templateTokens?: string[];
  templatePreviewRows?: string[];
  templateStatusMessage?: string | null;
  renderMode: CanvasNodeRenderMode;
  canResize: boolean;
  lockAspectRatio: boolean;
  resolvedSize: WorkflowNodeSize;
  presentation: ResolvedCanvasNodePresentation;
};

export type CanvasConnection = CanvasConnectionSelection;

export type CanvasInsertRequest = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  connectionNodeId?: string;
  connectionPort?: "input" | "output";
};

export type CanvasPhantomNodeKind = "asset" | "text-note" | "list" | "text-template" | "mystery";

export type CanvasPhantomNode = {
  id: string;
  kind: CanvasPhantomNodeKind;
  label: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
};

export type CanvasPhantomPreview = {
  sourceNodeId: string;
  nodes: CanvasPhantomNode[];
  overflowCount: number;
  runDisabledReason: string | null;
};
