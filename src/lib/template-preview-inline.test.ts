import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeTemplatePreviewInline } from "./template-preview-inline";

test("tokenizeTemplatePreviewInline preserves text order around template variables", () => {
  assert.deepEqual(tokenizeTemplatePreviewInline("Paint [[Animal]] in [[Habitat]]."), [
    {
      type: "text",
      value: "Paint ",
    },
    {
      type: "token",
      value: "Animal",
      raw: "[[Animal]]",
    },
    {
      type: "text",
      value: " in ",
    },
    {
      type: "token",
      value: "Habitat",
      raw: "[[Habitat]]",
    },
    {
      type: "text",
      value: ".",
    },
  ]);
});

test("tokenizeTemplatePreviewInline returns plain text unchanged when no tokens exist", () => {
  assert.deepEqual(tokenizeTemplatePreviewInline("Plain prompt text"), [
    {
      type: "text",
      value: "Plain prompt text",
    },
  ]);
});
