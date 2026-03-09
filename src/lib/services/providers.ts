import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerModels } from "@/lib/db/schema";
import { getAllProviderModels } from "@/lib/providers/registry";
import { listGoogleGeminiAvailableModelIds } from "@/lib/server/google-gemini";
import {
  clearProviderCredential as clearStoredProviderCredential,
  listProviderCredentials as listStoredProviderCredentials,
  saveProviderCredential as saveStoredProviderCredential,
} from "@/lib/runtime/provider-credentials";
import type {
  ProviderCredentialKey,
  ProviderCredentialStatus,
  ProviderId,
  ProviderModel,
} from "@/components/workspace/types";
import type { ProviderModelCapabilities, ProviderModelDescriptor } from "@/lib/types";
import { nowIso } from "@/lib/services/common";

function mergePersistedAccessState(
  model: ProviderModelDescriptor,
  persisted: typeof providerModels.$inferSelect | undefined
): ProviderModelDescriptor {
  if (!persisted?.capabilities || model.capabilities.accessReason === "missing_key") {
    return model;
  }

  const persistedCapabilities = persisted.capabilities as ProviderModelCapabilities;

  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      accessStatus: persistedCapabilities.accessStatus ?? model.capabilities.accessStatus,
      accessReason: persistedCapabilities.accessReason ?? model.capabilities.accessReason,
      accessMessage: persistedCapabilities.accessMessage ?? model.capabilities.accessMessage,
      lastCheckedAt: persistedCapabilities.lastCheckedAt ?? model.capabilities.lastCheckedAt,
      runnable:
        model.capabilities.runnable &&
        (persistedCapabilities.accessStatus ? persistedCapabilities.accessStatus !== "blocked" : true),
    },
  };
}

async function refreshGoogleGeminiModelAccess(models: ProviderModelDescriptor[]) {
  const geminiModels = models.filter((model) => model.providerId === "google-gemini");
  if (geminiModels.length === 0) {
    return models;
  }

  const configured = geminiModels.some((model) => model.capabilities.apiKeyConfigured);
  if (!configured) {
    return models.map<ProviderModelDescriptor>((model) =>
      model.providerId !== "google-gemini"
        ? model
        : {
            ...model,
            capabilities: {
              ...model.capabilities,
              accessStatus: "blocked",
              accessReason: "missing_key",
              accessMessage: "Save GOOGLE_API_KEY in Settings or set it in .env.local and restart the app.",
              lastCheckedAt: null,
              runnable: false,
            },
          }
    );
  }

  try {
    const { modelIds, checkedAt } = await listGoogleGeminiAvailableModelIds();
    return models.map<ProviderModelDescriptor>((model) => {
      if (model.providerId !== "google-gemini") {
        return model;
      }

      const available = modelIds.has(model.modelId);
      const accessMessage = available
        ? "Available for this Gemini project."
        : model.capabilities.billingAvailability === "paid_only"
          ? "Requires a paid Gemini API project."
          : "Unavailable for this Gemini project.";

      return {
        ...model,
        capabilities: {
          ...model.capabilities,
          accessStatus: available ? "available" : "blocked",
          accessReason: available ? null : "not_listed",
          accessMessage,
          lastCheckedAt: checkedAt,
          runnable: model.capabilities.runnable && available,
        },
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini access refresh failed.";
    return models.map<ProviderModelDescriptor>((model) =>
      model.providerId !== "google-gemini"
        ? model
        : {
            ...model,
            capabilities: {
              ...model.capabilities,
              accessStatus: "unknown",
              accessReason: "probe_failed",
              accessMessage: `Gemini model access could not be verified: ${message}`,
              lastCheckedAt: nowIso(),
              runnable: model.capabilities.runnable,
            },
          }
    );
  }
}

async function refreshProviderModelAccess(
  models: ProviderModelDescriptor[],
  providerId?: ProviderId | null
) {
  if (!providerId || providerId === "google-gemini") {
    return refreshGoogleGeminiModelAccess(models);
  }

  return models;
}

export async function syncProviderModels(options?: { refreshAccess?: boolean; providerId?: ProviderId | null }) {
  const db = getDb();
  const existing = db.select().from(providerModels).all();
  const existingMap = new Map(existing.map((row) => [`${row.providerId}:${row.modelId}`, row] as const));
  let models = await getAllProviderModels();
  models = models.map((model) => mergePersistedAccessState(model, existingMap.get(`${model.providerId}:${model.modelId}`)));
  if (options?.refreshAccess) {
    models = await refreshProviderModelAccess(models, options.providerId);
  }
  const activeKeys = new Set(models.map((model) => `${model.providerId}:${model.modelId}`));

  for (const row of existing) {
    if (!activeKeys.has(`${row.providerId}:${row.modelId}`)) {
      db.update(providerModels)
        .set({ active: false, updatedAt: nowIso() })
        .where(and(eq(providerModels.providerId, row.providerId), eq(providerModels.modelId, row.modelId)))
        .run();
    }
  }

  for (const model of models) {
    db.insert(providerModels)
      .values({
        providerId: model.providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        capabilities: model.capabilities,
        active: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .onConflictDoUpdate({
        target: [providerModels.providerId, providerModels.modelId],
        set: {
          displayName: model.displayName,
          capabilities: model.capabilities,
          active: true,
          updatedAt: nowIso(),
        },
      })
      .run();
  }
}

export async function listProviders(): Promise<ProviderModel[]> {
  await syncProviderModels();
  const db = getDb();

  return db
    .select()
    .from(providerModels)
    .where(eq(providerModels.active, true))
    .orderBy(asc(providerModels.providerId), asc(providerModels.displayName))
    .all()
    .map((model) => ({
      providerId: model.providerId as ProviderModel["providerId"],
      modelId: model.modelId,
      displayName: model.displayName,
      capabilities: model.capabilities,
    }));
}

export async function listProviderCredentials(): Promise<ProviderCredentialStatus[]> {
  return listStoredProviderCredentials();
}

export async function saveProviderCredential(key: ProviderCredentialKey, value: string) {
  await saveStoredProviderCredential(key, value);
  await syncProviderModels({
    refreshAccess: key === "GOOGLE_API_KEY",
    providerId: key === "GOOGLE_API_KEY" ? "google-gemini" : null,
  });
}

export async function clearProviderCredential(key: ProviderCredentialKey) {
  await clearStoredProviderCredential(key);
  await syncProviderModels({
    refreshAccess: key === "GOOGLE_API_KEY",
    providerId: key === "GOOGLE_API_KEY" ? "google-gemini" : null,
  });
}

export async function refreshProviderAccess(providerId?: ProviderId | null) {
  await syncProviderModels({
    refreshAccess: true,
    providerId: providerId || null,
  });
}

export async function updateProviderModelAccessState(
  providerId: ProviderId,
  modelId: string,
  nextState: Pick<
    ProviderModelCapabilities,
    "accessStatus" | "accessReason" | "accessMessage"
  >
) {
  const db = getDb();
  const existing = db
    .select()
    .from(providerModels)
    .where(and(eq(providerModels.providerId, providerId), eq(providerModels.modelId, modelId)))
    .get();

  if (!existing) {
    return;
  }

  const capabilities = existing.capabilities as ProviderModelCapabilities;
  db.update(providerModels)
    .set({
      capabilities: {
        ...capabilities,
        ...nextState,
        lastCheckedAt: nowIso(),
        runnable:
          capabilities.runnable &&
          (nextState.accessStatus ? nextState.accessStatus !== "blocked" : capabilities.accessStatus !== "blocked"),
      },
      updatedAt: nowIso(),
    })
    .where(and(eq(providerModels.providerId, providerId), eq(providerModels.modelId, modelId)))
    .run();
}
