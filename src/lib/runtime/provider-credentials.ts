import { APP_ID } from "@/lib/runtime/app-meta";
import { loadAppEnv } from "@/lib/runtime/load-env";
import type {
  ProviderCredentialKey,
  ProviderCredentialSource,
  ProviderCredentialStatus,
} from "@/components/workspace/types";

type ProviderCredentialResolution = ProviderCredentialStatus & {
  value: string | null;
};

export const PROVIDER_CREDENTIAL_KEYS: ProviderCredentialKey[] = [
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "TOPAZ_API_KEY",
];

let keytarModulePromise: Promise<{
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
} | null> | null = null;

function normalizeCredentialValue(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  return trimmed.length > 0 ? trimmed : null;
}

async function getKeytarModule() {
  if (!keytarModulePromise) {
    keytarModulePromise = import("keytar")
      .then((module) => {
        const keytar = module.default || module;
        return keytar;
      })
      .catch((error) => {
        console.warn("[provider-credentials] keytar unavailable; falling back to environment-only credentials.", error);
        return null;
      });
  }

  return keytarModulePromise;
}

function getEnvironmentCredentialValue(key: ProviderCredentialKey) {
  loadAppEnv();
  return normalizeCredentialValue(process.env[key]);
}

async function getKeychainCredentialValue(key: ProviderCredentialKey) {
  const keytar = await getKeytarModule();
  if (!keytar) {
    return null;
  }

  return normalizeCredentialValue(await keytar.getPassword(APP_ID, key));
}

export async function resolveProviderCredential(key: ProviderCredentialKey): Promise<ProviderCredentialResolution> {
  const keychainValue = await getKeychainCredentialValue(key);
  if (keychainValue) {
    return {
      key,
      configured: true,
      source: "keychain",
      value: keychainValue,
    };
  }

  const environmentValue = getEnvironmentCredentialValue(key);
  if (environmentValue) {
    return {
      key,
      configured: true,
      source: "environment",
      value: environmentValue,
    };
  }

  return {
    key,
    configured: false,
    source: "none",
    value: null,
  };
}

export async function resolveProviderCredentialValue(key: ProviderCredentialKey) {
  return (await resolveProviderCredential(key)).value;
}

export async function listProviderCredentials(): Promise<ProviderCredentialStatus[]> {
  const credentials = await Promise.all(PROVIDER_CREDENTIAL_KEYS.map((key) => resolveProviderCredential(key)));
  return credentials.map((credential) => ({
    key: credential.key,
    configured: credential.configured,
    source: credential.source,
  }));
}

export async function saveProviderCredential(key: ProviderCredentialKey, value: string) {
  const normalizedValue = normalizeCredentialValue(value);
  if (!normalizedValue) {
    throw new Error(`Enter a value for ${key}.`);
  }

  const keytar = await getKeytarModule();
  if (!keytar) {
    throw new Error("Keychain access is unavailable on this machine.");
  }

  await keytar.setPassword(APP_ID, key, normalizedValue);
}

export async function clearProviderCredential(key: ProviderCredentialKey) {
  const keytar = await getKeytarModule();
  if (!keytar) {
    return;
  }

  await keytar.deletePassword(APP_ID, key);
}

export function getCredentialSourceLabel(source: ProviderCredentialSource) {
  if (source === "keychain") {
    return "Keychain";
  }

  if (source === "environment") {
    return "Environment";
  }

  return "None";
}
