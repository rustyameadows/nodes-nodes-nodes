import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasNodeAccentColor,
  getCanvasNodeBorderLayers,
  resolveCanvasNodeBorderSemantics,
} from "./canvas-node-design-system";

test("canvas node accent colors stay aligned with the preserved semantic palette", () => {
  assert.equal(getCanvasNodeAccentColor("text"), "#ff4dc4");
  assert.equal(getCanvasNodeAccentColor("image"), "#3ea4ff");
  assert.equal(getCanvasNodeAccentColor("citrus"), "#d8ff3e");
  assert.equal(getCanvasNodeAccentColor("operator"), "#9b4dff");
  assert.equal(getCanvasNodeAccentColor("failed"), "#ff8aa3");
});

test("canvas node border layers blend left inputs into the right output accent", () => {
  const layers = getCanvasNodeBorderLayers(["text", "image"], "citrus", "text");

  assert.match(layers.top, /#ff4dc4/);
  assert.match(layers.top, /#d8ff3e/);
  assert.match(layers.left, /#3ea4ff/);
  assert.match(layers.right, /#d8ff3e/);
});

test("canvas node border layers fall back to the requested semantic accent when no inputs are present", () => {
  const layers = getCanvasNodeBorderLayers([], "text", "text");

  assert.match(layers.top, /#ff4dc4/);
  assert.match(layers.left, /#ff4dc4/);
  assert.match(layers.right, /#ff4dc4/);
});

test("fresh operator nodes stay neutral until they have downstream output", () => {
  const semantics = resolveCanvasNodeBorderSemantics({
    kind: "text-template",
    outputAccentType: "operator",
    inputAccentTypes: [],
    generatedProvenance: null,
    processingState: null,
    hasConnectedOutput: false,
  });

  assert.deepEqual(semantics.leftAccentTypes, []);
  assert.equal(semantics.fallbackLeftAccentType, "neutral");
  assert.equal(semantics.rightAccentType, "neutral");
  assert.equal(semantics.shouldShowProcessingShimmer, false);
});

test("operator nodes advertise purple output once they have downstream output", () => {
  const semantics = resolveCanvasNodeBorderSemantics({
    kind: "text-template",
    outputAccentType: "operator",
    inputAccentTypes: ["text"],
    generatedProvenance: null,
    processingState: null,
    hasConnectedOutput: true,
  });

  assert.deepEqual(semantics.leftAccentTypes, ["text"]);
  assert.equal(semantics.rightAccentType, "operator");
});

test("operator-produced notes keep the operator accent on the left edge", () => {
  const semantics = resolveCanvasNodeBorderSemantics({
    kind: "text-note",
    outputAccentType: "text",
    inputAccentTypes: [],
    generatedProvenance: "operator",
    processingState: null,
    hasConnectedOutput: false,
  });

  assert.deepEqual(semantics.leftAccentTypes, ["operator"]);
  assert.equal(semantics.fallbackLeftAccentType, "operator");
  assert.equal(semantics.rightAccentType, "text");
});

test("model-produced note and image outputs use citrus on the left edge", () => {
  const noteSemantics = resolveCanvasNodeBorderSemantics({
    kind: "text-note",
    outputAccentType: "text",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: null,
    hasConnectedOutput: false,
  });
  const imageSemantics = resolveCanvasNodeBorderSemantics({
    kind: "asset-source",
    assetOrigin: "generated",
    outputAccentType: "image",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: null,
    hasConnectedOutput: false,
  });

  assert.deepEqual(noteSemantics.leftAccentTypes, ["citrus"]);
  assert.equal(noteSemantics.rightAccentType, "text");
  assert.deepEqual(imageSemantics.leftAccentTypes, ["citrus"]);
  assert.equal(imageSemantics.rightAccentType, "image");
});

test("model-produced operator outputs stay citrus-left and purple-right", () => {
  const semantics = resolveCanvasNodeBorderSemantics({
    kind: "text-template",
    outputAccentType: "operator",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: null,
    hasConnectedOutput: false,
  });

  assert.deepEqual(semantics.leftAccentTypes, ["citrus"]);
  assert.equal(semantics.fallbackLeftAccentType, "citrus");
  assert.equal(semantics.rightAccentType, "operator");
});

test("failed nodes force only the right edge to red", () => {
  const modelSemantics = resolveCanvasNodeBorderSemantics({
    kind: "model",
    outputAccentType: "citrus",
    inputAccentTypes: ["text"],
    generatedProvenance: null,
    processingState: "failed",
    hasConnectedOutput: true,
  });
  const generatedSemantics = resolveCanvasNodeBorderSemantics({
    kind: "text-note",
    outputAccentType: "text",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: "failed",
    hasConnectedOutput: false,
  });

  assert.deepEqual(modelSemantics.leftAccentTypes, ["text"]);
  assert.equal(modelSemantics.rightAccentType, "failed");
  assert.deepEqual(generatedSemantics.leftAccentTypes, ["citrus"]);
  assert.equal(generatedSemantics.rightAccentType, "failed");
});

test("processing shimmer only applies to queued or running generated outputs", () => {
  const runningGenerated = resolveCanvasNodeBorderSemantics({
    kind: "text-note",
    outputAccentType: "text",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: "running",
    hasConnectedOutput: false,
  });
  const failedGenerated = resolveCanvasNodeBorderSemantics({
    kind: "text-note",
    outputAccentType: "text",
    inputAccentTypes: [],
    generatedProvenance: "model",
    processingState: "failed",
    hasConnectedOutput: false,
  });
  const runningModel = resolveCanvasNodeBorderSemantics({
    kind: "model",
    outputAccentType: "citrus",
    inputAccentTypes: [],
    generatedProvenance: null,
    processingState: "running",
    hasConnectedOutput: true,
  });

  assert.equal(runningGenerated.shouldShowProcessingShimmer, true);
  assert.equal(failedGenerated.shouldShowProcessingShimmer, false);
  assert.equal(runningModel.shouldShowProcessingShimmer, false);
});
