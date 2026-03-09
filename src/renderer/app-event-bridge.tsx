import { useEffect } from "react";
import { subscribeToAppEvent } from "@/components/workspace/client-api";
import { queryClient, queryKeys } from "@/renderer/query";

function invalidateProjectScopedRoot(rootKey: "workspace" | "assets" | "jobs", projectId?: string) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const [key, value] = query.queryKey;
      if (key !== rootKey) {
        return false;
      }

      if (!projectId) {
        return true;
      }

      return value === projectId;
    },
  });
}

export function AppEventBridge() {
  useEffect(() => {
    const unsubscribeProjects = subscribeToAppEvent("projects.changed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    });

    const unsubscribeWorkspace = subscribeToAppEvent("workspace.changed", ({ projectId }) => {
      invalidateProjectScopedRoot("workspace", projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    });

    const unsubscribeAssets = subscribeToAppEvent("assets.changed", ({ projectId }) => {
      invalidateProjectScopedRoot("assets", projectId);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "asset",
      });
    });

    const unsubscribeJobs = subscribeToAppEvent("jobs.changed", ({ projectId }) => {
      invalidateProjectScopedRoot("jobs", projectId);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "job-debug" && (!projectId || query.queryKey[1] === projectId),
      });
    });

    const unsubscribeProviders = subscribeToAppEvent("providers.changed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.providerCredentials });
    });

    return () => {
      unsubscribeProjects();
      unsubscribeWorkspace();
      unsubscribeAssets();
      unsubscribeJobs();
      unsubscribeProviders();
    };
  }, []);

  return null;
}
