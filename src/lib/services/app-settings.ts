import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appSettings as appSettingsTable } from "@/lib/db/schema";
import type { AppSettings } from "@/components/workspace/types";
import { APP_FEATURE_FLAG_DEFAULTS, normalizeFeatureFlags } from "@/lib/feature-flags";
import { nowIso } from "@/lib/services/common";

const APP_SETTINGS_ROW_ID = "singleton";

const DEFAULT_APP_SETTINGS: AppSettings = {
  featureFlags: APP_FEATURE_FLAG_DEFAULTS,
};

function normalizeAppSettingsRow(row: typeof appSettingsTable.$inferSelect | undefined): AppSettings {
  if (!row) {
    return DEFAULT_APP_SETTINGS;
  }

  return {
    featureFlags: normalizeFeatureFlags(row.featureFlags),
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const db = getDb();
  const row = db.select().from(appSettingsTable).where(eq(appSettingsTable.id, APP_SETTINGS_ROW_ID)).get();
  return normalizeAppSettingsRow(row);
}

export async function saveAppSettings(input: AppSettings): Promise<AppSettings> {
  const db = getDb();
  const nextSettings: AppSettings = {
    featureFlags: normalizeFeatureFlags(input.featureFlags),
  };

  db.insert(appSettingsTable)
    .values({
      id: APP_SETTINGS_ROW_ID,
      featureFlags: nextSettings.featureFlags,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: {
        featureFlags: nextSettings.featureFlags,
        updatedAt: nowIso(),
      },
    })
    .run();

  return nextSettings;
}
