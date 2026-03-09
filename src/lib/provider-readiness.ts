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
  accessStatus?: "available" | "blocked" | "limited" | "unknown" | null;
  accessReason?:
    | "missing_key"
    | "not_listed"
    | "billing_required"
    | "permission_denied"
    | "quota_exhausted"
    | "rate_limited"
    | "temporary_unavailable"
    | "invalid_input"
    | "probe_failed"
    | null;
  accessMessage?: string | null;
  billingAvailability?: "free_and_paid" | "paid_only" | null;
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

export function isProviderAccessBlocked(capabilities: CapabilitiesLike | null | undefined) {
  return capabilities?.accessStatus === "blocked";
}

export function isProviderAccessLimited(capabilities: CapabilitiesLike | null | undefined) {
  return capabilities?.accessStatus === "limited";
}

export function formatProviderAccessMessage(capabilities: CapabilitiesLike | null | undefined) {
  if (!capabilities) {
    return null;
  }

  if (capabilities.accessMessage) {
    return capabilities.accessMessage;
  }

  if (capabilities.accessReason === "missing_key" && capabilities.requiresApiKeyEnv) {
    return `Save ${capabilities.requiresApiKeyEnv} in Settings or set it in .env.local and restart the app.`;
  }

  if (capabilities.accessReason === "not_listed") {
    return capabilities.billingAvailability === "paid_only"
      ? "Requires a paid Gemini API project."
      : "Unavailable for this Gemini project.";
  }

  if (capabilities.accessReason === "billing_required") {
    return "This Gemini model requires billing on the current Google project.";
  }

  if (capabilities.accessReason === "permission_denied") {
    return "This Gemini project does not have permission to use this model.";
  }

  if (capabilities.accessReason === "quota_exhausted") {
    return "This Gemini project is temporarily limited because its quota is exhausted.";
  }

  if (capabilities.accessReason === "rate_limited") {
    return "This Gemini project is currently rate limited.";
  }

  if (capabilities.accessReason === "temporary_unavailable") {
    return "Gemini is temporarily unavailable for this model.";
  }

  if (capabilities.accessReason === "probe_failed") {
    return "Gemini model access could not be verified. Try refreshing access.";
  }

  if (capabilities.accessReason === "invalid_input") {
    return "Gemini rejected the current request for this model.";
  }

  return null;
}
