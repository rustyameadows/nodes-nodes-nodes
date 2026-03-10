import assert from "node:assert/strict";
import test from "node:test";
import { getCanvasNodeActionDescriptors } from "./canvas-node-actions";

test("template preview actions expose edit, run, and compact controls", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "text-template",
    persistedMode: "preview",
    renderMode: "preview",
    isEditing: false,
    canRun: true,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.tone, action.disabled ?? false]),
    [
      ["edit", "neutral", false],
      ["run", "accent", false],
      ["compact", "neutral", false],
    ]
  );
});

test("image asset actions expose open, download, and debug when available", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "image-asset",
    persistedMode: "preview",
    renderMode: "preview",
    isEditing: false,
    hasAsset: true,
    hasDebug: true,
  });

  assert.deepEqual(actions.map((action) => action.id), ["open", "download", "debug"]);
});

test("resized model actions restore default and compact modes", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "model",
    persistedMode: "resized",
    renderMode: "resized",
    isEditing: false,
  });

  assert.deepEqual(actions.map((action) => action.id), ["default", "compact"]);
});
