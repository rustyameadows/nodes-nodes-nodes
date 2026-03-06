import path from "node:path";
import {
  buildTopazOutputDimensionFields,
  getTopazImageModelProfile,
  getTopazOutputFormatForMimeType,
  normalizeLegacyTopazModelId,
  resolveTopazImageSettings,
} from "@/lib/topaz-image-settings";
import type { NormalizedOutput, ProviderInputAsset } from "@/lib/types";

const TOPAZ_API_BASE_URL = "https://api.topazlabs.com/image/v1";
const TOPAZ_API_KEY_ENV = "TOPAZ_API_KEY";
const TOPAZ_POLL_INTERVAL_MS = 2000;
const TOPAZ_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/tiff") {
    return "tiff";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function mimeTypeFromResponse(contentType: string | null, fallbackMimeType: string) {
  if (!contentType) {
    return fallbackMimeType;
  }
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp" || normalized === "image/tiff") {
    return normalized;
  }
  return fallbackMimeType;
}

function getTopazApiKey() {
  const apiKey = process.env[TOPAZ_API_KEY_ENV]?.trim();
  if (!apiKey) {
    const error = new Error(`Topaz is not configured. Set ${TOPAZ_API_KEY_ENV} in .env.local and restart npm run dev.`) as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    error.code = "CONFIG_ERROR";
    error.details = {
      requirement: getTopazApiRequirement(),
    };
    throw error;
  }
  return apiKey;
}

export function getTopazApiRequirement() {
  const apiKey = process.env[TOPAZ_API_KEY_ENV]?.trim();
  return {
    kind: "env" as const,
    key: TOPAZ_API_KEY_ENV,
    configured: Boolean(apiKey),
    label: "Topaz API key",
  };
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  return text || null;
}

function createTopazApiError(message: string, details?: Record<string, unknown>, code = "PROVIDER_ERROR") {
  const error = new Error(message) as Error & { code?: string; details?: Record<string, unknown> };
  error.code = code;
  error.details = details;
  return error;
}

async function topazFetchJson(url: string, init: RequestInit, context: Record<string, unknown>) {
  const response = await fetch(url, init);
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw createTopazApiError(
      typeof body === "object" && body && "message" in body && typeof body.message === "string"
        ? body.message
        : `Topaz API request failed with status ${response.status}.`,
      {
        ...context,
        status: response.status,
        response: body,
      }
    );
  }

  return typeof body === "object" && body ? (body as Record<string, unknown>) : {};
}

async function topazFetchBinary(
  url: string,
  init: RequestInit,
  context: Record<string, unknown>,
  fallbackMimeType: string
) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await parseResponseBody(response);
    throw createTopazApiError(
      typeof body === "object" && body && "message" in body && typeof body.message === "string"
        ? body.message
        : `Topaz API request failed with status ${response.status}.`,
      {
        ...context,
        status: response.status,
        response: body,
      }
    );
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: mimeTypeFromResponse(response.headers.get("content-type"), fallbackMimeType),
    filename: null as string | null,
  };
}

function coerceProcessId(payload: Record<string, unknown>) {
  const candidate = payload.process_id ?? payload.processId ?? payload.id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function readStatusValue(payload: Record<string, unknown>) {
  const candidate = payload.status ?? payload.state ?? payload.phase;
  return typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
}

function isCompletedStatus(status: string) {
  return ["complete", "completed", "success", "succeeded", "done", "finished"].includes(status);
}

function isFailedStatus(status: string) {
  return ["failed", "error", "errored", "canceled", "cancelled"].includes(status);
}

function getDownloadUrl(payload: Record<string, unknown>, processId: string) {
  const candidateKeys = ["download_url", "downloadUrl", "result_url", "resultUrl", "output_url", "outputUrl"] as const;
  for (const key of candidateKeys) {
    const candidate = payload[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return `${TOPAZ_API_BASE_URL}/download/${processId}`;
}

async function pollTopazStatus(processId: string, apiKey: string) {
  const startedAt = Date.now();
  let pollCount = 0;
  let lastPayload: Record<string, unknown> | null = null;
  let lastStatus = "queued";

  while (Date.now() - startedAt < TOPAZ_POLL_TIMEOUT_MS) {
    pollCount += 1;
    const payload = await topazFetchJson(
      `${TOPAZ_API_BASE_URL}/status/${processId}`,
      {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      },
      {
        endpoint: "/status/{process_id}",
        processId,
        pollCount,
      }
    );

    lastPayload = payload;
    lastStatus = readStatusValue(payload);

    if (isCompletedStatus(lastStatus)) {
      return {
        pollCount,
        lastStatus,
        payload,
      };
    }

    if (isFailedStatus(lastStatus)) {
      throw createTopazApiError(
        typeof payload.message === "string" ? payload.message : `Topaz processing failed with status ${lastStatus}.`,
        {
          endpoint: "/status/{process_id}",
          processId,
          pollCount,
          status: lastStatus,
          response: payload,
        }
      );
    }

    await new Promise((resolve) => setTimeout(resolve, TOPAZ_POLL_INTERVAL_MS));
  }

  throw createTopazApiError("Timed out waiting for Topaz API job completion.", {
    endpoint: "/status/{process_id}",
    processId,
    pollCount,
    status: lastStatus,
    response: lastPayload,
  });
}

async function downloadTopazOutput(downloadUrl: string, apiKey: string, processId: string, fallbackMimeType: string) {
  const headers: HeadersInit = {};
  if (downloadUrl.startsWith(TOPAZ_API_BASE_URL)) {
    headers["X-API-Key"] = apiKey;
  }

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers,
    redirect: "follow",
  });

  if (!response.ok) {
    const body = await parseResponseBody(response);
    throw createTopazApiError(
      `Topaz download failed with status ${response.status}.`,
      {
        endpoint: "/download/{process_id}",
        processId,
        status: response.status,
        response: body,
        downloadUrl,
      }
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = mimeTypeFromResponse(response.headers.get("content-type"), fallbackMimeType);
  const contentDisposition = response.headers.get("content-disposition") || "";
  const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, "")) : null;

  return {
    buffer,
    mimeType,
    filename,
  };
}

export async function executeTopazImageApi(options: {
  modelId: string;
  prompt: string;
  settings: Record<string, unknown> | undefined;
  inputAsset: ProviderInputAsset;
}): Promise<{
  output: NormalizedOutput;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}> {
  const apiKey = getTopazApiKey();
  const normalizedModelId = normalizeLegacyTopazModelId(options.modelId) || "high_fidelity_v2";
  const profile = getTopazImageModelProfile(normalizedModelId);
  const resolvedSettings = resolveTopazImageSettings(options.settings, normalizedModelId);
  const prompt = options.prompt.trim();
  const outputFormat = getTopazOutputFormatForMimeType(options.inputAsset.mimeType);
  const outputMimeType = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "tiff" ? "image/tiff" : "image/png";
  const outputDimensionFields = buildTopazOutputDimensionFields(resolvedSettings.scale, {
    assetId: options.inputAsset.assetId,
    mimeType: options.inputAsset.mimeType,
    width: options.inputAsset.width ?? null,
    height: options.inputAsset.height ?? null,
  });

  if (!("output_width" in outputDimensionFields) && !("output_height" in outputDimensionFields)) {
    throw createTopazApiError(
      "Topaz requires source image dimensions to calculate the requested upscale size.",
      {
        endpoint: profile.endpointPath,
        modelId: normalizedModelId,
        assetId: options.inputAsset.assetId,
        width: options.inputAsset.width ?? null,
        height: options.inputAsset.height ?? null,
      },
      "INVALID_INPUT"
    );
  }

  const form = new FormData();
  const inputBytes = new Uint8Array(options.inputAsset.buffer);
  form.append(
    "image",
    new Blob([inputBytes], { type: options.inputAsset.mimeType }),
    `${options.inputAsset.assetId}.${extensionForMimeType(options.inputAsset.mimeType)}`
  );
  form.append("model", profile.apiModel);
  form.append("output_format", outputFormat);
  for (const [key, value] of Object.entries(outputDimensionFields)) {
    form.append(key, String(value));
  }

  if (profile.promptMode !== "unsupported" && prompt) {
    form.append("prompt", prompt);
  }

  if (resolvedSettings.creativity !== null) {
    form.append("creativity", String(resolvedSettings.creativity));
  }

  if (resolvedSettings.texture !== null) {
    form.append("texture", String(resolvedSettings.texture));
  }

  const requestDetails: Record<string, unknown> = {
    endpoint: profile.endpointPath,
    baseUrl: TOPAZ_API_BASE_URL,
    model: profile.apiModel,
    output_format: outputFormat,
    inputAssetId: options.inputAsset.assetId,
    ...outputDimensionFields,
    ...(profile.promptMode !== "unsupported" && prompt ? { prompt } : {}),
    ...(resolvedSettings.creativity !== null ? { creativity: resolvedSettings.creativity } : {}),
    ...(resolvedSettings.texture !== null ? { texture: resolvedSettings.texture } : {}),
  };

  if (profile.requestMode === "sync") {
    const syncOutput = await topazFetchBinary(
      `${TOPAZ_API_BASE_URL}${profile.endpointPath}`,
      {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          Accept: outputMimeType,
        },
        body: form,
      },
      {
        endpoint: profile.endpointPath,
        modelId: normalizedModelId,
      },
      outputMimeType
    );

    const extension = path.extname(syncOutput.filename || "").replace(/^\./, "") || extensionForMimeType(syncOutput.mimeType);

    return {
      output: {
        type: "image",
        mimeType: syncOutput.mimeType,
        extension,
        encoding: "binary",
        content: syncOutput.buffer,
        metadata: {
          providerId: "topaz",
          modelId: normalizedModelId,
          executionMode: "edit",
          scale: resolvedSettings.scale,
          creativity: resolvedSettings.creativity,
          texture: resolvedSettings.texture,
          prompt: profile.promptMode !== "unsupported" && prompt ? prompt : null,
        },
      },
      request: requestDetails,
      response: {
        mode: "sync",
        outputMimeType: syncOutput.mimeType,
        outputFilename: syncOutput.filename,
      },
    };
  }

  const submitPayload = await topazFetchJson(
    `${TOPAZ_API_BASE_URL}${profile.endpointPath}`,
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      body: form,
    },
    {
      endpoint: profile.endpointPath,
      modelId: normalizedModelId,
    }
  );

  const processId = coerceProcessId(submitPayload);
  if (!processId) {
    throw createTopazApiError("Topaz API did not return a process ID.", {
      endpoint: profile.endpointPath,
      response: submitPayload,
    });
  }

  const polled = await pollTopazStatus(processId, apiKey);
  const downloadUrl = getDownloadUrl(polled.payload, processId);
  const downloaded = await downloadTopazOutput(downloadUrl, apiKey, processId, options.inputAsset.mimeType);
  const extension = path.extname(downloaded.filename || "").replace(/^\./, "") || extensionForMimeType(downloaded.mimeType);

  return {
    output: {
      type: "image",
      mimeType: downloaded.mimeType,
      extension,
      encoding: "binary",
      content: downloaded.buffer,
      metadata: {
        providerId: "topaz",
        modelId: normalizedModelId,
        executionMode: "edit",
        scale: resolvedSettings.scale,
        creativity: resolvedSettings.creativity,
        texture: resolvedSettings.texture,
        prompt: profile.promptMode !== "unsupported" && prompt ? prompt : null,
        processId,
      },
    },
    request: requestDetails,
    response: {
      mode: "async",
      processId,
      submit: submitPayload,
      status: polled.payload,
      pollCount: polled.pollCount,
      lastStatus: polled.lastStatus,
      downloadUrl,
      outputMimeType: downloaded.mimeType,
      outputFilename: downloaded.filename,
    },
  };
}

export const getTopazGigapixelRequirement = getTopazApiRequirement;
export const executeTopazGigapixelCli = executeTopazImageApi;
