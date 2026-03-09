import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  const value = stripWrappingQuotes(rawValue);
  return { key, value };
}

let hasLoadedAppEnv = false;

export function loadAppEnv() {
  if (hasLoadedAppEnv) {
    return;
  }

  const envPaths = [".env", ".env.local"].map((fileName) => path.resolve(process.cwd(), fileName));

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const fileContents = readFileSync(envPath, "utf8");
    for (const line of fileContents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed || process.env[parsed.key] !== undefined) {
        continue;
      }

      process.env[parsed.key] = parsed.value;
    }
  }

  hasLoadedAppEnv = true;
}
