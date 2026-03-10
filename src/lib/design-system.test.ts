import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUiDataAttributes,
  findForbiddenColorLiterals,
  getDesignSystemTokenVariableNames,
  isDesignSystemGuardrailFile,
  normalizeUiDensity,
  normalizeUiSurface,
  tokenVar,
} from "@/lib/design-system";

test("buildUiDataAttributes only includes explicit surface and density", () => {
  assert.deepEqual(buildUiDataAttributes("app", "compact"), {
    "data-ui-surface": "app",
    "data-ui-density": "compact",
  });

  assert.deepEqual(buildUiDataAttributes(undefined, "comfortable"), {
    "data-ui-density": "comfortable",
  });
});

test("design-system helpers normalize surface and density defaults", () => {
  assert.equal(normalizeUiSurface(), "app");
  assert.equal(normalizeUiDensity(), "comfortable");
});

test("tokenVar and token variable registry expose stable CSS variable names", () => {
  assert.equal(tokenVar(["color", "stone", "0"]), "--ds-color-stone-0");

  const tokenNames = getDesignSystemTokenVariableNames();
  assert(tokenNames.includes("--ds-color-stone-0"));
  assert(tokenNames.includes("--ds-app-textPrimary"));
});

test("guardrail scope matcher only targets migrated design-system files", () => {
  assert.equal(isDesignSystemGuardrailFile("src/components/ui/ui.module.css"), true);
  assert.equal(isDesignSystemGuardrailFile("src/components/canvas-nodes/canvas-node.module.css"), true);
  assert.equal(isDesignSystemGuardrailFile("src/components/workspace/views/app-home-view.module.css"), true);
  assert.equal(isDesignSystemGuardrailFile("src/styles/design-system/variables.css"), false);
  assert.equal(isDesignSystemGuardrailFile("src/components/infinite-canvas.module.css"), false);
});

test("forbidden color literal detection ignores ds vars but catches raw colors", () => {
  const content = `
    .root {
      --ds-test-color: rgba(0, 0, 0, 0.4);
      color: #ffffff;
      background: var(--ds-surface-panel);
    }
  `;

  assert.deepEqual(findForbiddenColorLiterals(content), ["#ffffff"]);
});
