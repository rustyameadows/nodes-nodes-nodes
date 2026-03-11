import assert from "node:assert/strict";
import test from "node:test";
import { getCanvasNodeTitleChip } from "./canvas-node-title-chip";

test("model title chip uses the current model label with citrus color", () => {
  const chip = getCanvasNodeTitleChip({
    kind: "model",
    assetOrigin: null,
    outputType: "image",
    displayModelName: "Nano Banana 2",
    modelId: "gemini-3.1-flash-image-preview",
  });

  assert.deepEqual(chip, {
    label: "Nano Banana 2",
    accentType: "citrus",
    color: "#d8ff3e",
  });
});

test("text notes and lists keep the text accent chip labels while templates use operator purple", () => {
  assert.deepEqual(
    getCanvasNodeTitleChip({
      kind: "text-note",
      assetOrigin: null,
      outputType: "text",
      displayModelName: null,
      modelId: "gpt-5.4",
    }),
    {
      label: "Text Note",
      accentType: "text",
      color: "#ff4dc4",
    }
  );

  assert.deepEqual(
    getCanvasNodeTitleChip({
      kind: "list",
      assetOrigin: null,
      outputType: "text",
      displayModelName: null,
      modelId: "gpt-5.4",
    }),
    {
      label: "List / Sheet",
      accentType: "text",
      color: "#ff4dc4",
    }
  );

  assert.deepEqual(
    getCanvasNodeTitleChip({
      kind: "text-template",
      assetOrigin: null,
      outputType: "text",
      displayModelName: null,
      modelId: "gpt-5.4",
    }),
    {
      label: "Template Node",
      accentType: "operator",
      color: "#9b4dff",
    }
  );
});

test("asset title chips differentiate uploaded and generated labels while following output semantics", () => {
  assert.deepEqual(
    getCanvasNodeTitleChip({
      kind: "asset-source",
      assetOrigin: "uploaded",
      outputType: "image",
      displayModelName: null,
      modelId: "gpt-image-1.5",
    }),
    {
      label: "Uploaded Asset",
      accentType: "image",
      color: "#3ea4ff",
    }
  );

  assert.deepEqual(
    getCanvasNodeTitleChip({
      kind: "asset-source",
      assetOrigin: "generated",
      outputType: "video",
      displayModelName: null,
      modelId: "gpt-image-1.5",
    }),
    {
      label: "Generated Asset",
      accentType: "video",
      color: "#ff8d34",
    }
  );
});
