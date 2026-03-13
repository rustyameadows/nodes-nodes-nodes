import {
  createDefaultListNodeSettings,
  createReferenceNodeSettings,
  createTextNoteSettings,
  createTextTemplateNodeSettings,
} from "@/lib/list-template";
import type { ProviderId, ProviderModel, WorkflowNode } from "@/components/workspace/types";

export type NodeCatalogEntryId =
  | "model"
  | "text-note"
  | "reference"
  | "list"
  | "text-template"
  | "asset-uploaded"
  | "asset-generated";

export type NodeCatalogInsertContext = "canvas" | "model-input" | "template-input";
export type NodeCatalogCategory = "Generation" | "Text" | "Data" | "Knowledge" | "Assets";
export type NodeCatalogDisplayMode = "preview" | "compact" | "full" | "resized";
export type SpawnableNodeCatalogKind = "text-note" | "reference" | "list" | "text-template";

export type NodeCatalogVariantStatus =
  | "ready"
  | "missing_key"
  | "unverified"
  | "unavailable"
  | "temporarily_limited"
  | "coming_soon";

export type NodeCatalogVariant = {
  id: string;
  entryId: "model";
  providerId: ProviderId;
  modelId: string;
  label: string;
  providerLabel: string;
  description: string;
  availabilityLabel: string;
  status: NodeCatalogVariantStatus;
  disabled: boolean;
  disabledReason: string | null;
  outputType: WorkflowNode["outputType"];
  defaultSettings: Record<string, unknown>;
};

export type NodeCatalogPromptHarnessSummary = {
  kind: SpawnableNodeCatalogKind;
  label: string;
  promptSummary: string;
  payloadSummary: string;
};

export type NodePlaygroundFixture = {
  primaryNodeId: string;
  resizePresetSize: {
    width: number;
    height: number;
  };
  nodes: WorkflowNode[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};

export type NodeCatalogEntry = {
  id: NodeCatalogEntryId;
  label: string;
  shortDescription: string;
  category: NodeCatalogCategory;
  inputSummary: string;
  outputSummary: string;
  insertableOnCanvas: boolean;
  insertContexts: NodeCatalogInsertContext[];
  hasVariants: boolean;
  supportedDisplayModes: NodeCatalogDisplayMode[];
  detailCopy: string;
  settingsSummary: string[];
  variantHint?: string;
  promptHarnessSummary?: NodeCatalogPromptHarnessSummary;
  buildPlaygroundFixture: (providerModels: ProviderModel[]) => NodePlaygroundFixture;
};

type CatalogBaseDefinition = Omit<NodeCatalogEntry, "variantHint" | "buildPlaygroundFixture"> & {
  buildFixture: (providerModels: ProviderModel[]) => NodePlaygroundFixture;
};

const providerLabels: Record<ProviderId, string> = {
  openai: "OpenAI",
  "google-gemini": "Google Gemini",
  topaz: "Topaz",
};

function getProviderLabel(providerId: ProviderId) {
  return providerLabels[providerId] || providerId;
}

function getVariantStatus(model: ProviderModel): NodeCatalogVariantStatus {
  if (model.capabilities.availability === "coming_soon") {
    return "coming_soon";
  }

  if (model.capabilities.accessReason === "missing_key") {
    return "missing_key";
  }

  if (model.capabilities.accessStatus === "unknown") {
    return "unverified";
  }

  if (model.capabilities.accessStatus === "limited") {
    return "temporarily_limited";
  }

  if (model.capabilities.accessStatus === "blocked" || !model.capabilities.runnable) {
    return "unavailable";
  }

  return "ready";
}

function getVariantAvailabilityLabel(model: ProviderModel) {
  const status = getVariantStatus(model);
  if (status === "ready") {
    return "Ready";
  }
  if (status === "missing_key") {
    return "Missing key";
  }
  if (status === "unverified") {
    return "Unverified";
  }
  if (status === "temporarily_limited") {
    return "Temporarily limited";
  }
  if (status === "unavailable") {
    if (
      model.capabilities.billingAvailability === "paid_only" &&
      (model.capabilities.accessReason === "not_listed" || model.capabilities.accessReason === "billing_required")
    ) {
      return "Requires paid tier";
    }

    return "Unavailable";
  }
  return "Coming soon";
}

function getVariantDisabledReason(model: ProviderModel) {
  const status = getVariantStatus(model);
  if (status === "missing_key" || status === "coming_soon") {
    return model.capabilities.accessMessage || null;
  }

  if (status === "unavailable") {
    return model.capabilities.accessMessage || "This model is unavailable for the current provider configuration.";
  }

  return null;
}

function getModelOutputType(model: ProviderModel): WorkflowNode["outputType"] {
  if (model.capabilities.text) {
    return "text";
  }
  if (model.capabilities.video) {
    return "video";
  }
  return "image";
}

function createFallbackModel(): ProviderModel {
  return {
    providerId: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    capabilities: {
      text: false,
      image: true,
      video: false,
      runnable: false,
      availability: "ready",
      billingAvailability: "free_and_paid",
      accessStatus: "blocked",
      accessReason: "missing_key",
      accessMessage: "Save OPENAI_API_KEY in Settings or set it in .env.local and restart the app.",
      lastCheckedAt: null,
      requiresApiKeyEnv: "OPENAI_API_KEY",
      apiKeyConfigured: false,
      requirements: [
        {
          kind: "env",
          key: "OPENAI_API_KEY",
          configured: false,
          label: "OpenAI API key",
        },
      ],
      promptMode: "required",
      executionModes: ["generate", "edit"],
      acceptedInputMimeTypes: [],
      maxInputImages: 0,
      parameters: [],
      defaults: {},
    },
  };
}

export function getDefaultModelCatalogVariant(providerModels: ProviderModel[]): NodeCatalogVariant {
  const variants = getModelCatalogVariants(providerModels);
  return (
    variants.find((variant) => variant.providerId === "openai" && variant.modelId === "gpt-image-1.5") ||
    variants.find((variant) => variant.status === "ready") ||
    variants[0] ||
    createModelCatalogVariant(createFallbackModel())
  );
}

function createModelCatalogVariant(model: ProviderModel): NodeCatalogVariant {
  return {
    id: `model:${model.providerId}:${model.modelId}`,
    entryId: "model",
    providerId: model.providerId,
    modelId: model.modelId,
    label: model.displayName,
    providerLabel: getProviderLabel(model.providerId),
    description: model.modelId,
    availabilityLabel: getVariantAvailabilityLabel(model),
    status: getVariantStatus(model),
    disabled: getVariantStatus(model) === "missing_key" || getVariantStatus(model) === "unavailable" || getVariantStatus(model) === "coming_soon",
    disabledReason: getVariantDisabledReason(model),
    outputType: getModelOutputType(model),
    defaultSettings: { ...(model.capabilities.defaults || {}) },
  };
}

export function getModelCatalogVariants(providerModels: ProviderModel[]) {
  return providerModels.map((model) => createModelCatalogVariant(model));
}

export function getModelCatalogVariantById(providerModels: ProviderModel[], variantId: string) {
  return getModelCatalogVariants(providerModels).find((variant) => variant.id === variantId) || null;
}

export function groupModelCatalogVariants(providerModels: ProviderModel[]) {
  return getModelCatalogVariants(providerModels).reduce<Record<ProviderId, NodeCatalogVariant[]>>((acc, variant) => {
    acc[variant.providerId] = acc[variant.providerId] || [];
    acc[variant.providerId].push(variant);
    return acc;
  }, {} as Record<ProviderId, NodeCatalogVariant[]>);
}

export function formatModelVariantLabel(variant: NodeCatalogVariant) {
  return `${variant.providerLabel} · ${variant.label}`;
}

function createBaseModelNode(
  providerModels: ProviderModel[],
  overrides?: Partial<WorkflowNode>
): WorkflowNode {
  const variant = getDefaultModelCatalogVariant(providerModels);
  return {
    id: overrides?.id || "library-model",
    label: overrides?.label || "Image Generator",
    providerId: overrides?.providerId || variant.providerId,
    modelId: overrides?.modelId || variant.modelId,
    kind: "model",
    nodeType: overrides?.nodeType || (variant.outputType === "text" ? "text-gen" : variant.outputType === "video" ? "video-gen" : "image-gen"),
    outputType: overrides?.outputType || variant.outputType,
    prompt: overrides?.prompt || "",
    settings: { ...variant.defaultSettings, ...(overrides?.settings || {}) },
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: overrides?.promptSourceNodeId || null,
    upstreamNodeIds: overrides?.upstreamNodeIds || [],
    upstreamAssetIds: overrides?.upstreamAssetIds || [],
    x: overrides?.x ?? 520,
    y: overrides?.y ?? 200,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}

function createBaseTextNoteNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: overrides?.id || "library-note",
    label: overrides?.label || "Prompt Note",
    providerId: overrides?.providerId || "openai",
    modelId: overrides?.modelId || "gpt-image-1.5",
    kind: "text-note",
    nodeType: "text-note",
    outputType: "text",
    prompt: overrides?.prompt || "",
    settings: overrides?.settings || createTextNoteSettings(),
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: overrides?.x ?? 180,
    y: overrides?.y ?? 220,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}


function createBaseReferenceNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: overrides?.id || "library-reference",
    label: overrides?.label || "Reference",
    providerId: overrides?.providerId || "openai",
    modelId: overrides?.modelId || "gpt-image-1.5",
    kind: "reference",
    nodeType: "reference",
    outputType: "text",
    prompt: overrides?.prompt || "",
    settings: overrides?.settings || createReferenceNodeSettings(),
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: overrides?.upstreamNodeIds || [],
    upstreamAssetIds: overrides?.upstreamAssetIds || [],
    x: overrides?.x ?? 220,
    y: overrides?.y ?? 180,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}

function createBaseListNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: overrides?.id || "library-list",
    label: overrides?.label || "Sample List",
    providerId: overrides?.providerId || "openai",
    modelId: overrides?.modelId || "gpt-image-1.5",
    kind: "list",
    nodeType: "list",
    outputType: "text",
    prompt: overrides?.prompt || "",
    settings: overrides?.settings || createDefaultListNodeSettings(),
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: [],
    upstreamAssetIds: [],
    x: overrides?.x ?? 180,
    y: overrides?.y ?? 180,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}

function createBaseTemplateNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: overrides?.id || "library-template",
    label: overrides?.label || "Prompt Template",
    providerId: overrides?.providerId || "openai",
    modelId: overrides?.modelId || "gpt-image-1.5",
    kind: "text-template",
    nodeType: "text-template",
    outputType: "text",
    prompt: overrides?.prompt || "",
    settings: overrides?.settings || createTextTemplateNodeSettings(),
    sourceAssetId: null,
    sourceAssetMimeType: null,
    sourceJobId: null,
    sourceOutputIndex: null,
    processingState: null,
    promptSourceNodeId: null,
    upstreamNodeIds: overrides?.upstreamNodeIds || [],
    upstreamAssetIds: overrides?.upstreamAssetIds || [],
    x: overrides?.x ?? 540,
    y: overrides?.y ?? 180,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}

function createBaseAssetNode(overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: overrides?.id || "library-asset",
    label: overrides?.label || "Reference Asset",
    providerId: overrides?.providerId || "openai",
    modelId: overrides?.modelId || "gpt-image-1.5",
    kind: "asset-source",
    nodeType: "image-gen",
    outputType: overrides?.outputType || "image",
    prompt: "",
    settings: overrides?.settings || { source: "uploaded" },
    sourceAssetId: overrides?.sourceAssetId || null,
    sourceAssetMimeType: overrides?.sourceAssetMimeType || null,
    sourceJobId: overrides?.sourceJobId || null,
    sourceOutputIndex: overrides?.sourceOutputIndex ?? null,
    processingState: overrides?.processingState || null,
    promptSourceNodeId: overrides?.promptSourceNodeId || null,
    upstreamNodeIds: overrides?.upstreamNodeIds || [],
    upstreamAssetIds: overrides?.upstreamAssetIds || [],
    x: overrides?.x ?? 280,
    y: overrides?.y ?? 180,
    displayMode: overrides?.displayMode || "preview",
    size: overrides?.size || null,
  };
}

const baseDefinitions: CatalogBaseDefinition[] = [
  {
    id: "model",
    label: "Model Node",
    shortDescription: "Runs a provider model and spawns text, image, or video outputs.",
    category: "Generation",
    inputSummary: "Prompt note, asset inputs, list/template outputs downstream.",
    outputSummary: "Generated assets or structured text children.",
    insertableOnCanvas: true,
    insertContexts: ["canvas"],
    hasVariants: true,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Model nodes are the execution engines in the graph. They can take prompt notes or assets as inputs, expose provider-specific settings, and spawn generated child nodes on run.",
    settingsSummary: ["Provider + model", "Prompt text", "Provider parameters", "Output target"],
    buildFixture(providerModels) {
      const modelNode = createBaseModelNode(providerModels, {
        id: "library-model-primary",
        label: "Image Generator",
        prompt: "Illustrate a cheerful river otter in a clean editorial style.",
        x: 380,
        y: 200,
      });

      return {
        primaryNodeId: modelNode.id,
        resizePresetSize: { width: 640, height: 420 },
        nodes: [modelNode],
        viewport: { x: -40, y: 24, zoom: 0.9 },
      };
    },
  },
  {
    id: "text-note",
    label: "Text Note",
    shortDescription: "Stores freeform text, prompt fragments, or annotations directly on canvas.",
    category: "Text",
    inputSummary: "Manual text or generated text.",
    outputSummary: "Text prompt source for models and templates.",
    insertableOnCanvas: true,
    insertContexts: ["canvas", "model-input"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Text notes are lightweight writing surfaces. Use them for prompt fragments, briefs, and any freeform copy that should feed other nodes without forcing structure.",
    settingsSummary: ["Label", "Body copy", "Preview / compact / resized display"],
    promptHarnessSummary: {
      kind: "text-note",
      label: "Text note",
      promptSummary: "Use for plain written content, explanations, ideas, captions, or standalone text.",
      payloadSummary: "text-note nodes use the text field.",
    },
        buildFixture() {
      const noteNode = createBaseTextNoteNode({
        id: "library-text-note-primary",
        label: "Idea Note",
        prompt:
          "Cute northern UK animals with soft, minimal shapes and simple white-background compositions.",
        x: 240,
        y: 200,
        displayMode: "preview",
      });

      return {
        primaryNodeId: noteNode.id,
        resizePresetSize: { width: 420, height: 280 },
        nodes: [noteNode],
        viewport: { x: 110, y: 44, zoom: 1.05 },
      };
    },
  },

  {
    id: "reference",
    label: "Reference Node",
    shortDescription: "Canonical project entity for a durable real-world subject.",
    category: "Knowledge",
    inputSummary: "Manual fields, URL/source notes, optional supporting visuals and attributes.",
    outputSummary: "Reusable canonical subject context for downstream model and planning nodes.",
    insertableOnCanvas: true,
    insertContexts: ["canvas", "model-input"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Reference nodes anchor durable entities such as products, people, locations, brands, and objects. They mix identity data, flexible structured facts, notes, and provenance for reuse across the graph.",
    settingsSummary: [
      "Identity and type",
      "Structured attributes",
      "Source URL + notes",
      "Provenance + freshness",
    ],
        buildFixture() {
      const referenceNode = createBaseReferenceNode({
        id: "library-reference-primary",
        label: "Horizon Lounge Chair",
        prompt: "Compact premium lounge chair reference for campaign consistency.",
        settings: {
          source: "reference",
          referenceType: "product",
          subtitle: "Walnut frame · Moss boucle",
          status: "enriched",
          sourceUrl: "https://example.com/products/horizon-lounge-chair",
          attributes: {
            dimensions: 'W 82cm × D 88cm × H 76cm',
            materials: "Walnut, boucle upholstery",
            configurations: "Ottoman optional",
          },
          sourceNotes: "Keep silhouette and warm fabric tones consistent across scenes.",
          visualAssetIds: [],
          provenance: "url-import",
          lastEnrichedAt: "2026-03-13T00:00:00.000Z",
        },
        x: 220,
        y: 140,
        size: { width: 420, height: 286 },
        displayMode: "resized",
      });

      return {
        primaryNodeId: referenceNode.id,
        resizePresetSize: { width: 420, height: 286 },
        nodes: [referenceNode],
        viewport: { x: -24, y: 30, zoom: 0.88 },
      };
    },
  },

  {
    id: "list",
    label: "List / Sheet",
    shortDescription: "Structured rows and columns for repeated prompts, records, or datasets.",
    category: "Data",
    inputSummary: "Manual rows or model-generated structured data.",
    outputSummary: "Reusable records for templates and prompt generation.",
    insertableOnCanvas: true,
    insertContexts: ["canvas", "template-input"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "List nodes are inline sheets. They hold column-based structured data that can be edited directly, previewed on canvas, and piped into template generation.",
    settingsSummary: ["Columns", "Rows", "Editable full sheet", "Resizable workspace"],
    promptHarnessSummary: {
      kind: "list",
      label: "List",
      promptSummary: "Use for structured repeated data, rows, tabular information, records, or datasets.",
      payloadSummary: "list nodes use columns and rows.",
    },
        buildFixture() {
      const listNode = createBaseListNode({
        id: "library-list-primary",
        label: "Cute Northern UK Animals",
        settings: {
          source: "list",
          columns: [
            { id: "list-col-name", label: "Common name" },
            { id: "list-col-habitat", label: "Where in northern UK" },
            { id: "list-col-traits", label: "Cute traits" },
          ],
          rows: [
            {
              id: "list-row-1",
              values: {
                "list-col-name": "Red Fox",
                "list-col-habitat": "Woodlands, moor edges",
                "list-col-traits": "Bushy tail, bright face",
              },
            },
            {
              id: "list-row-2",
              values: {
                "list-col-name": "European Hedgehog",
                "list-col-habitat": "Gardens, hedgerows",
                "list-col-traits": "Round snout, tiny paws",
              },
            },
            {
              id: "list-row-3",
              values: {
                "list-col-name": "Otter",
                "list-col-habitat": "Rivers and estuaries",
                "list-col-traits": "Whiskers, curious pose",
              },
            },
          ],
        },
        x: 180,
        y: 120,
        size: { width: 760, height: 460 },
        displayMode: "resized",
      });

      return {
        primaryNodeId: listNode.id,
        resizePresetSize: { width: 760, height: 460 },
        nodes: [listNode],
        viewport: { x: -10, y: 20, zoom: 0.78 },
      };
    },
  },
  {
    id: "text-template",
    label: "Template Node",
    shortDescription: "Reusable prompt or writing pattern with live list-aware merge preview.",
    category: "Text",
    inputSummary: "Template text plus an optional connected list.",
    outputSummary: "Merged text rows or downstream prompt batches.",
    insertableOnCanvas: true,
    insertContexts: ["canvas"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Template nodes pair freeform writing with structured list inputs. They detect variables, validate compatibility, and show merged previews directly inside the node.",
    settingsSummary: ["Template text", "Variable shelf", "Compatibility checks", "Inline merge preview"],
    promptHarnessSummary: {
      kind: "text-template",
      label: "Text template",
      promptSummary: "Use for reusable prompt or writing patterns with fill-in placeholders.",
      payloadSummary: "text-template nodes use templateText with [[variable]] placeholders.",
    },
        buildFixture() {
      const listNode = createBaseListNode({
        id: "library-template-list",
        label: "Animal Data",
        settings: {
          source: "list",
          columns: [
            { id: "template-col-animal", label: "Animal" },
            { id: "template-col-pose", label: "Pose" },
            { id: "template-col-traits", label: "Cute traits" },
          ],
          rows: [
            {
              id: "template-row-1",
              values: {
                "template-col-animal": "Otter",
                "template-col-pose": "curled beside a river rock",
                "template-col-traits": "whiskers and bright paws",
              },
            },
            {
              id: "template-row-2",
              values: {
                "template-col-animal": "Puffin",
                "template-col-pose": "standing forward",
                "template-col-traits": "wide bill and orange feet",
              },
            },
          ],
        },
        x: 120,
        y: 180,
      });
      const templateNode = createBaseTemplateNode({
        id: "library-template-primary",
        label: "Illustration Prompt",
        prompt:
          "Illustrate a simple, cute [[Animal]] in a natural pose: [[Pose]]. Highlight [[Cute traits]].",
        upstreamNodeIds: [listNode.id],
        upstreamAssetIds: [`node:${listNode.id}`],
        x: 500,
        y: 160,
        size: { width: 640, height: 420 },
        displayMode: "resized",
      });

      return {
        primaryNodeId: templateNode.id,
        resizePresetSize: { width: 640, height: 420 },
        nodes: [listNode, templateNode],
        viewport: { x: -24, y: 20, zoom: 0.8 },
      };
    },
  },
  {
    id: "asset-uploaded",
    label: "Uploaded Asset",
    shortDescription: "Pointer node for files imported into the local project asset store.",
    category: "Assets",
    inputSummary: "Imported local file.",
    outputSummary: "Image, video, or text asset reference.",
    insertableOnCanvas: true,
    insertContexts: ["canvas", "model-input"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Uploaded asset nodes point to files already in the project asset store. They act as reusable references for edits, transforms, and comparison flows.",
    settingsSummary: ["Asset preview", "Open in viewer", "Download", "Resizable image framing"],
        buildFixture() {
      const assetNode = createBaseAssetNode({
        id: "library-uploaded-asset",
        label: "Uploaded Asset",
        settings: { source: "uploaded" },
        x: 260,
        y: 180,
      });

      return {
        primaryNodeId: assetNode.id,
        resizePresetSize: { width: 320, height: 320 },
        nodes: [assetNode],
        viewport: { x: 56, y: 42, zoom: 1.02 },
      };
    },
  },
  {
    id: "asset-generated",
    label: "Generated Asset",
    shortDescription: "Pointer node to a model-produced output with preserved source lineage.",
    category: "Assets",
    inputSummary: "Completed model job output.",
    outputSummary: "Generated asset reference with source-call lineage.",
    insertableOnCanvas: true,
    insertContexts: ["canvas", "model-input"],
    hasVariants: false,
    supportedDisplayModes: ["preview", "compact", "full", "resized"],
    detailCopy:
      "Generated asset nodes are one-time spawned children from model runs. They keep source-call metadata for inspection, but behave like normal user-owned nodes after creation.",
    settingsSummary: ["Preview frame", "Source lineage", "Open in viewer", "Resizable image framing"],
    buildFixture(providerModels) {
      const modelNode = createBaseModelNode(providerModels, {
        id: "library-generated-model",
        label: "Image Generator",
        x: 120,
        y: 200,
      });
      const assetNode = createBaseAssetNode({
        id: "library-generated-asset",
        label: "Generated Output",
        settings: {
          source: "generated-preview",
          sourceModelNodeId: modelNode.id,
          sourceJobId: "library-job-1",
          outputIndex: 0,
          descriptorIndex: 0,
        },
        sourceJobId: "library-job-1",
        sourceOutputIndex: 0,
        upstreamNodeIds: [modelNode.id],
        upstreamAssetIds: [`node:${modelNode.id}`],
        x: 520,
        y: 180,
      });

      return {
        primaryNodeId: assetNode.id,
        resizePresetSize: { width: 320, height: 320 },
        nodes: [modelNode, assetNode],
        viewport: { x: 8, y: 30, zoom: 0.9 },
      };
    },
  },
];

export function getSpawnableNodeCatalogSummaries(): NodeCatalogPromptHarnessSummary[] {
  return baseDefinitions
    .map((definition) => definition.promptHarnessSummary || null)
    .filter((summary): summary is NodeCatalogPromptHarnessSummary => Boolean(summary));
}

export function getNodeCatalogEntries(providerModels: ProviderModel[]) {
  const modelVariants = getModelCatalogVariants(providerModels);
  const providerCount = new Set(modelVariants.map((variant) => variant.providerId)).size;
  const modelVariantHint =
    modelVariants.length > 0
      ? `${providerCount} provider${providerCount === 1 ? "" : "s"} · ${modelVariants.length} model${modelVariants.length === 1 ? "" : "s"}`
      : "Provider-backed variants";

  return baseDefinitions.map((definition) => ({
    ...definition,
    variantHint: definition.id === "model" ? modelVariantHint : undefined,
    buildPlaygroundFixture: definition.buildFixture,
  }));
}

export function getNodeCatalogEntry(entryId: string, providerModels: ProviderModel[]) {
  return getNodeCatalogEntries(providerModels).find((entry) => entry.id === entryId) || null;
}

export function getInsertableNodeCatalogEntries(
  context: NodeCatalogInsertContext,
  providerModels: ProviderModel[]
) {
  return getNodeCatalogEntries(providerModels).filter(
    (entry) => entry.insertableOnCanvas && entry.insertContexts.includes(context)
  );
}

export function buildNodeCatalogMachineSummary() {
  return getSpawnableNodeCatalogSummaries()
    .map((summary) => `${summary.kind}: ${summary.promptSummary} ${summary.payloadSummary}`)
    .join(" ");
}

const nodeCatalog = {
  buildNodeCatalogMachineSummary,
  formatModelVariantLabel,
  getDefaultModelCatalogVariant,
  getInsertableNodeCatalogEntries,
  getModelCatalogVariantById,
  getModelCatalogVariants,
  getNodeCatalogEntries,
  getNodeCatalogEntry,
  getSpawnableNodeCatalogSummaries,
  groupModelCatalogVariants,
};

export default nodeCatalog;
