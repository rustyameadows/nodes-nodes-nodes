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
    actions.map((action) => [action.id, action.slot, action.tone, action.disabled ?? false]),
    [
      ["compact", "top-left", "neutral", false],
      ["edit", "bottom", "neutral", false],
      ["run", "bottom", "accent", false],
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

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["compact", "top-left"],
      ["open", "bottom"],
      ["download", "bottom"],
      ["debug", "bottom"],
    ]
  );
});

test("resized model actions restore default and compact modes while keeping duplicate in the footer", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "model",
    persistedMode: "resized",
    renderMode: "resized",
    isEditing: false,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["default", "top-left"],
      ["compact", "top-left"],
      ["duplicate", "bottom"],
    ]
  );
});

test("transient full model actions expose default immediately on first open", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "model",
    persistedMode: "preview",
    renderMode: "full",
    isEditing: false,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["default", "top-left"],
      ["compact", "top-left"],
      ["duplicate", "bottom"],
    ]
  );
});

test("transient full model actions keep compact available when the persisted mode is compact", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "model",
    persistedMode: "compact",
    renderMode: "full",
    isEditing: false,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["default", "top-left"],
      ["compact", "top-left"],
      ["duplicate", "bottom"],
    ]
  );
});

test("persisted full model actions still expose default and compact", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "model",
    persistedMode: "full",
    renderMode: "full",
    isEditing: false,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["default", "top-left"],
      ["compact", "top-left"],
      ["duplicate", "bottom"],
    ]
  );
});

test("list actions place add column in the bottom rail", () => {
  const actions = getCanvasNodeActionDescriptors({
    interactionPolicy: "list",
    persistedMode: "preview",
    renderMode: "preview",
    isEditing: false,
  });

  assert.deepEqual(
    actions.map((action) => [action.id, action.slot]),
    [
      ["compact", "top-left"],
      ["add-column", "bottom"],
    ]
  );
});
