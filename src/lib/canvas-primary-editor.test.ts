import assert from "node:assert/strict";
import test from "node:test";
import { resolvePrimaryCanvasEditorId } from "@/lib/canvas-primary-editor";

test("maps node kinds to their primary inline full-mode editors", () => {
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "model" }, { hasSourceJob: false }), "prompt");
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "text-note" }, { hasSourceJob: false }), "note");
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "list" }, { hasSourceJob: false }), "list");
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "text-template" }, { hasSourceJob: false }), "template");
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "asset-source" }, { hasSourceJob: false }), "asset-details");
});

test("prefers the source-call editor when a selected node has a source job", () => {
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "asset-source" }, { hasSourceJob: true }), "source-call");
  assert.equal(resolvePrimaryCanvasEditorId({ kind: "text-note" }, { hasSourceJob: true }), "source-call");
});

test("returns null when there is no selected node", () => {
  assert.equal(resolvePrimaryCanvasEditorId(null, { hasSourceJob: false }), null);
});
