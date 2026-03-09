import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerModels } from "@/lib/db/schema";
import { getAllProviderModels } from "@/lib/providers/registry";
import {
  clearProviderCredential as clearStoredProviderCredential,
  listProviderCredentials as listStoredProviderCredentials,
  saveProviderCredential as saveStoredProviderCredential,
} from "@/lib/runtime/provider-credentials";
import type {
  ProviderCredentialKey,
  ProviderCredentialStatus,
  ProviderModel,
} from "@/components/workspace/types";
import { nowIso } from "@/lib/services/common";

export async function syncProviderModels() {
  const db = getDb();
  const models = await getAllProviderModels();
  const activeKeys = new Set(models.map((model) => `${model.providerId}:${model.modelId}`));
  const existing = db.select().from(providerModels).all();

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
  await syncProviderModels();
}

export async function clearProviderCredential(key: ProviderCredentialKey) {
  await clearStoredProviderCredential(key);
  await syncProviderModels();
}
