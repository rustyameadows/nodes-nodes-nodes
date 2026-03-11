import assert from "node:assert/strict";
import test from "node:test";
import { getModelPromptSurfaceState } from "./model-node-editor";

test("getModelPromptSurfaceState returns editable prompt copy without a connected source", () => {
  const surface = getModelPromptSurfaceState({
    prompt: "Generate a studio portrait of an otter.",
    promptSourceNode: null,
  });

  assert.deepEqual(surface, {
    title: "Prompt",
    value: "Generate a studio portrait of an otter.",
    placeholder: "Describe what to generate",
    readOnly: false,
    isConnectedPreview: false,
  });
});

test("getModelPromptSurfaceState returns connected prompt preview content", () => {
  const surface = getModelPromptSurfaceState({
    prompt: "Fallback prompt",
    promptSourceNode: {
      label: "Prompt Note",
      prompt: "Pulled prompt copy from a connected note.",
    },
  });

  assert.deepEqual(surface, {
    title: "Prompt from Prompt Note",
    value: "Pulled prompt copy from a connected note.",
    placeholder: "Describe what to generate",
    readOnly: true,
    isConnectedPreview: true,
  });
});

test("getModelPromptSurfaceState exposes an empty-state placeholder for blank connected notes", () => {
  const surface = getModelPromptSurfaceState({
    prompt: "Fallback prompt",
    promptSourceNode: {
      label: "",
      prompt: "   ",
    },
  });

  assert.deepEqual(surface, {
    title: "Prompt from Connected note",
    value: "   ",
    placeholder: "Connected note is empty",
    readOnly: true,
    isConnectedPreview: true,
  });
});
