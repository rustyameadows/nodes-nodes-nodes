import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCanvasNode } from "@/lib/canvas-document";

test("normalizeCanvasNode preserves reference node kind and settings", () => {
  const normalized = normalizeCanvasNode(
    {
      id: "reference-1",
      label: "Reference 1",
      kind: "reference",
      providerId: "openai",
      modelId: "gpt-image-1.5",
      settings: {
        source: "reference",
        referenceType: "person",
        subtitle: "Creative Director",
        status: "enriched",
        sourceUrl: "https://example.com/person",
        attributes: {
          hair: "auburn",
        },
        sourceNotes: "Imported from brief",
        visualAssetIds: ["asset-1"],
        provenance: "url-import",
        lastEnrichedAt: "2026-03-12T09:30:00.000Z",
      },
    },
    0
  );

  assert.equal(normalized.kind, "reference");
  assert.equal(normalized.nodeType, "reference");
  assert.equal(normalized.outputType, "text");
  assert.deepEqual(normalized.settings, {
    source: "reference",
    referenceType: "person",
    subtitle: "Creative Director",
    status: "enriched",
    sourceUrl: "https://example.com/person",
    attributes: {
      hair: "auburn",
    },
    sourceNotes: "Imported from brief",
    visualAssetIds: ["asset-1"],
    provenance: "url-import",
    lastEnrichedAt: "2026-03-12T09:30:00.000Z",
  });
});
