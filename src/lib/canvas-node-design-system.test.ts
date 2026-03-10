import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasNodeAccentColor,
  getCanvasNodeBorderLayers,
} from "./canvas-node-design-system";

test("canvas node accent colors stay aligned with the preserved semantic palette", () => {
  assert.equal(getCanvasNodeAccentColor("text"), "#ff4dc4");
  assert.equal(getCanvasNodeAccentColor("image"), "#3ea4ff");
  assert.equal(getCanvasNodeAccentColor("citrus"), "#d8ff3e");
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
