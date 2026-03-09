export type RequirementLike = {
  kind?: "env" | "executable";
  key?: string | null;
  configured?: boolean;
  label?: string | null;
};

export type CapabilitiesLike = {
  requirements?: RequirementLike[] | null;
  requiresApiKeyEnv?: string | null;
  apiKeyConfigured?: boolean;
};

export function getProviderRequirements(capabilities: CapabilitiesLike | null | undefined): RequirementLike[] {
  if (capabilities?.requirements && capabilities.requirements.length > 0) {
    return capabilities.requirements;
  }

  if (capabilities?.requiresApiKeyEnv) {
    return [
      {
        kind: "env",
        key: capabilities.requiresApiKeyEnv,
        configured: Boolean(capabilities.apiKeyConfigured),
        label: capabilities.requiresApiKeyEnv,
      },
    ];
  }

  return [];
}

export function getFirstUnconfiguredRequirement(capabilities: CapabilitiesLike | null | undefined) {
  return getProviderRequirements(capabilities).find((requirement) => requirement.configured === false) || null;
}

export function formatProviderRequirementMessage(requirement: RequirementLike | null | undefined) {
  if (!requirement || !requirement.key) {
    return null;
  }

  if (requirement.kind === "env") {
    return `Save ${requirement.key} in Settings or set it in .env.local and restart the app.`;
  }

  const label = requirement.label || "Required executable";
  return `${label} is unavailable. Install or configure ${requirement.key} and restart the app.`;
}
