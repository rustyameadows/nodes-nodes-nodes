"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@/renderer/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getAsset, getAssetFileUrl, openProject } from "@/components/workspace/client-api";
import type { Asset } from "@/components/workspace/types";
import { queryKeys } from "@/renderer/query";
import styles from "./asset-detail-view.module.css";

type Props = {
  projectId: string;
  assetId: string;
};

function formatDate(value: string | undefined) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function getFilename(storageRef: string) {
  const chunks = storageRef.split("/");
  return chunks[chunks.length - 1] || storageRef;
}

export function AssetDetailView({ projectId, assetId }: Props) {
  const router = useRouter();
  const {
    data: asset,
    isLoading,
    error,
  } = useQuery<Asset>({
    queryKey: queryKeys.asset(assetId),
    queryFn: () => getAsset(assetId),
  });

  useEffect(() => {
    openProject(projectId).catch(console.error);
  }, [projectId]);

  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <WorkspaceShell projectId={projectId} view="assets">
      <main className={styles.page}>
        <section className={styles.panel}>
          <header className={styles.header}>
            <div className={styles.headerActions}>
              <button type="button" className={styles.backButton} onClick={() => router.push(`/projects/${projectId}/assets`)}>
                Back to Grid
              </button>
              {asset?.jobId ? (
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={() => router.push(`/projects/${projectId}/queue?inspectJobId=${asset.jobId}`)}
                >
                  View Source Call
                </button>
              ) : null}
            </div>
            <h1>Single Asset Viewer</h1>
          </header>

          <div className={styles.body}>
            <section className={styles.mediaPane}>
              {isLoading ? (
                <div className={styles.centerState}>Loading asset...</div>
              ) : errorMessage ? (
                <div className={styles.centerState}>{errorMessage}</div>
              ) : asset ? (
                <AssetMedia asset={asset} />
              ) : (
                <div className={styles.centerState}>Asset not found.</div>
              )}
            </section>

            <aside className={styles.metaPane}>
              <h2>Asset Info</h2>
              {!asset ? (
                <p className={styles.metaEmpty}>No asset metadata available.</p>
              ) : (
                <dl className={styles.metaList}>
                  <div className={styles.metaRow}>
                    <dt>Filename</dt>
                    <dd>{getFilename(asset.storageRef)}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Type</dt>
                    <dd>{asset.type}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Dimensions</dt>
                    <dd>{asset.width && asset.height ? `${asset.width} x ${asset.height}` : "unknown"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>MIME</dt>
                    <dd>{asset.mimeType}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Provider</dt>
                    <dd>{asset.job?.providerId || "upload/local"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Model</dt>
                    <dd>{asset.job?.modelId || "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Job ID</dt>
                    <dd>{asset.jobId || "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Job State</dt>
                    <dd>{asset.job?.state || "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Output Variant</dt>
                    <dd>{typeof asset.outputIndex === "number" ? asset.outputIndex + 1 : "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Created</dt>
                    <dd>{formatDate(asset.createdAt)}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Updated</dt>
                    <dd>{formatDate(asset.updatedAt)}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Rating</dt>
                    <dd>{asset.rating ?? "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Flagged</dt>
                    <dd>{asset.flagged ? "yes" : "no"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Tags</dt>
                    <dd>{asset.tagNames.length > 0 ? asset.tagNames.join(", ") : "-"}</dd>
                  </div>
                  <div className={styles.metaRow}>
                    <dt>Storage Ref</dt>
                    <dd className={styles.monoValue}>{asset.storageRef}</dd>
                  </div>
                </dl>
              )}
            </aside>
          </div>
        </section>
      </main>
    </WorkspaceShell>
  );
}

function AssetMedia({ asset }: { asset: Asset }) {
  if (asset.type === "image") {
    return <img className={styles.image} src={getAssetFileUrl(asset.id)} alt={`Asset ${asset.id}`} />;
  }

  if (asset.type === "text") {
    return <iframe className={styles.textFrame} src={getAssetFileUrl(asset.id)} title={`Asset ${asset.id}`} />;
  }

  return (
    <div className={styles.videoPlaceholder}>
      <p>Video asset preview is not yet implemented.</p>
      <a href={getAssetFileUrl(asset.id)} target="_blank" rel="noreferrer">
        Open file metadata
      </a>
    </div>
  );
}
