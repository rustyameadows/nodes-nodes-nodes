import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateVariableInsertText,
  buildReferencePromptText,
  buildTextTemplatePreview,
  createListColumn,
  createListRow,
  extractTemplateTokens,
  getTemplateVariableDisplayLabel,
  normalizeTemplateLabel,
} from "./list-template";
import type { ListNodeSettings } from "@/components/workspace/types";

function createSettings(columns: string[], rows: Array<Record<string, string>>): ListNodeSettings {
  const columnDefs = columns.map((label, index) => createListColumn(label, `col-${index + 1}`));

  return {
    source: "list",
    columns: columnDefs,
    rows: rows.map((row, index) =>
      createListRow(
        columnDefs.map((column) => column.id),
        Object.fromEntries(
          columnDefs.map((column) => [column.id, row[column.label] ?? ""])
        ),
        `row-${index + 1}`
      )
    ),
  };
}

test("normalizeTemplateLabel trims, collapses whitespace, and lowercases", () => {
  assert.equal(normalizeTemplateLabel("  Dog   Breed  "), "dog breed");
});

test("extractTemplateTokens returns unique normalized placeholders in source order", () => {
  const tokens = extractTemplateTokens("Hi [[ Dog Breed ]] and [[coat]] then [[dog breed]] again.");
  assert.deepEqual(
    tokens.map((token) => token.label),
    ["Dog Breed", "coat"]
  );
});

test("template variable display and insert helpers keep labels clean while preserving bracket syntax", () => {
  assert.equal(getTemplateVariableDisplayLabel("  Dog   Breed "), "Dog Breed");
  assert.equal(buildTemplateVariableInsertText("  Dog   Breed "), "[[Dog Breed]]");
});

test("buildTextTemplatePreview resolves placeholders case-insensitively", () => {
  const settings = createSettings(["Dog Breed", "Coat"], [{ "Dog Breed": "Akita", Coat: "Fluffy" }]);
  const preview = buildTextTemplatePreview("Meet [[ dog   breed ]] with [[COAT]].", settings);

  assert.equal(preview.disabledReason, null);
  assert.equal(preview.rows[0]?.text, "Meet Akita with Fluffy.");
});

test("buildTextTemplatePreview flags duplicate column labels", () => {
  const settings = createSettings(["Dog Breed", "dog breed"], [{ "Dog Breed": "Akita", "dog breed": "Beagle" }]);
  const preview = buildTextTemplatePreview("Meet [[dog breed]].", settings);

  assert.equal(preview.disabledReason, "Column names must be unique.");
  assert.equal(preview.duplicateColumnIds.length, 2);
});

test("buildTextTemplatePreview blocks unresolved placeholders", () => {
  const settings = createSettings(["Dog Breed"], [{ "Dog Breed": "Akita" }]);
  const preview = buildTextTemplatePreview("Meet [[dog breed]] with [[coat]].", settings);

  assert.equal(preview.disabledReason, "Add columns for the missing variables.");
  assert.deepEqual(
    preview.unresolvedTokens.map((token) => token.label),
    ["coat"]
  );
});

test("buildTextTemplatePreview renders blank cells as empty strings", () => {
  const settings = createSettings(["Dog Breed", "Coat"], [{ "Dog Breed": "Akita", Coat: "" }]);
  const preview = buildTextTemplatePreview("Meet [[dog breed]] with [[coat]].", settings);

  assert.equal(preview.disabledReason, null);
  assert.equal(preview.rows[0]?.text, "Meet Akita with .");
});

test("buildTextTemplatePreview skips fully blank rows and preserves row order", () => {
  const settings = createSettings(
    ["Dog Breed", "Coat"],
    [
      { "Dog Breed": "", Coat: "" },
      { "Dog Breed": "Akita", Coat: "Fluffy" },
      { "Dog Breed": "Beagle", Coat: "Short" },
      { "Dog Breed": "", Coat: "" },
    ]
  );
  const preview = buildTextTemplatePreview("Meet [[dog breed]] with [[coat]].", settings);

  assert.equal(preview.disabledReason, null);
  assert.equal(preview.nonBlankRowCount, 2);
  assert.deepEqual(
    preview.rows.map((row) => row.text),
    ["Meet Akita with Fluffy.", "Meet Beagle with Short."]
  );
});


test("buildReferencePromptText composes prompt content from key reference fields", () => {
  const prompt = buildReferencePromptText({
    source: "reference",
    referenceType: "product",
    subtitle: "Walnut lounge chair",
    status: "draft",
    sourceUrl: "https://example.com/chair",
    attributes: {
      Material: "Solid walnut",
      Width: "82cm",
    },
    sourceNotes: "",
    visualAssetIds: [],
    provenance: "manual",
    lastEnrichedAt: null,
  });

  assert.equal(
    prompt,
    [
      "Type: product",
      "Summary: Walnut lounge chair",
      "Source URL: https://example.com/chair",
      "Attributes:",
      "- Material: Solid walnut",
      "- Width: 82cm",
    ].join("\n")
  );
});
