export type ModelParameterControl = "select" | "number";
export type ModelParameterSection = "core" | "advanced";

export type ModelParameterOption = {
  value: string | number;
  label: string;
};

export type ModelParameterVisibilityRule = {
  executionModes?: string[];
  settingKey?: string;
  values?: Array<string | number>;
};

export type ModelParameterDefinition = {
  key: string;
  label: string;
  control: ModelParameterControl;
  section: ModelParameterSection;
  defaultValue?: string | number | null;
  helpText?: string;
  options?: ModelParameterOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  visibleWhen?: ModelParameterVisibilityRule[];
};

export function isModelParameterVisible(
  definition: ModelParameterDefinition,
  context: {
    executionMode: string;
    settings: Record<string, unknown>;
  }
) {
  if (!definition.visibleWhen || definition.visibleWhen.length === 0) {
    return true;
  }

  return definition.visibleWhen.every((rule) => {
    if (rule.executionModes && !rule.executionModes.includes(context.executionMode)) {
      return false;
    }

    if (rule.settingKey) {
      const value = context.settings[rule.settingKey];
      if (!rule.values || rule.values.length === 0) {
        return value !== undefined && value !== null && value !== "";
      }
      return rule.values.some((expectedValue) => expectedValue === value);
    }

    return true;
  });
}
