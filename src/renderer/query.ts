import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  projects: ["projects"] as const,
  appSettings: ["app-settings"] as const,
  providers: ["providers"] as const,
  providerCredentials: ["provider-credentials"] as const,
  workspace: (projectId: string) => ["workspace", projectId] as const,
  assets: (
    projectId: string,
    filters: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => ["assets", projectId, filters, options || null] as const,
  asset: (assetId: string) => ["asset", assetId] as const,
  jobs: (projectId: string) => ["jobs", projectId] as const,
  jobDebug: (projectId: string, jobId: string) => ["job-debug", projectId, jobId] as const,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1_000,
      refetchOnWindowFocus: false,
    },
  },
});
