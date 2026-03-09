"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchableModelSelect } from "@/components/searchable-model-select";
import { getProviders } from "@/components/workspace/client-api";
import { NodePlaygroundCanvas } from "@/components/workspace/node-playground-canvas";
import type { ProviderModel } from "@/components/workspace/types";
import { getDefaultModelCatalogVariant, getNodeCatalogEntry, getModelCatalogVariants } from "@/lib/node-catalog";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppHomeRoute,
  buildNodeLibraryRoute,
} from "@/renderer/workspace-route";
import styles from "./node-library-detail-view.module.css";

type Props = {
  nodeId: string;
};

export function NodeLibraryDetailView({ nodeId }: Props) {
  const router = useRouter();
  const { data: providers = [] } = useQuery<ProviderModel[]>({
    queryKey: queryKeys.providers,
    queryFn: getProviders,
  });

  const entry = useMemo(() => getNodeCatalogEntry(nodeId, providers), [nodeId, providers]);
  const modelVariants = useMemo(() => getModelCatalogVariants(providers), [providers]);
  const defaultModelVariant = useMemo(
    () => (modelVariants.length > 0 ? getDefaultModelCatalogVariant(providers) : null),
    [modelVariants.length, providers]
  );
  const [playgroundSeed, setPlaygroundSeed] = useState(0);
  const [selectedModelVariantId, setSelectedModelVariantId] = useState<string | null>(
    defaultModelVariant?.id || null
  );

  useEffect(() => {
    setSelectedModelVariantId(defaultModelVariant?.id || null);
  }, [defaultModelVariant?.id]);

  if (!entry) {
    return (
      <main className={styles.notFound}>
        <div>
          <h1>Node not found</h1>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              router.push(buildNodeLibraryRoute());
            }}
          >
            Back to Library
          </button>
        </div>
      </main>
    );
  }

  const fixture = entry.buildPlaygroundFixture(providers);

  return (
    <main className={styles.page}>
      <aside className={styles.sideRail}>
        <div className={styles.navRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              router.push(buildNodeLibraryRoute());
            }}
          >
            Node Library
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              router.push(buildAppHomeRoute());
            }}
          >
            Home
          </button>
        </div>

        <section className={styles.titleBlock}>
          <div className={styles.eyebrow}>{entry.category}</div>
          <h1>{entry.label}</h1>
          <p>{entry.detailCopy}</p>
        </section>

        <section className={styles.section}>
          <h2>I/O Contract</h2>
          <div className={styles.pillRow}>
            <span className={styles.pill}>{entry.inputSummary}</span>
            <span className={styles.pill}>{entry.outputSummary}</span>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Display Modes</h2>
          <div className={styles.pillRow}>
            {entry.supportedDisplayModes.map((mode) => (
              <span key={`${entry.id}-${mode}`} className={styles.pill}>
                {mode}
              </span>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Settings Surface</h2>
          <ul className={styles.bulletList}>
            {entry.settingsSummary.map((summary) => (
              <li key={`${entry.id}-${summary}`}>{summary}</li>
            ))}
          </ul>
        </section>

        {entry.id === "model" ? (
          <section className={styles.section}>
            <h2>Model Variant</h2>
            <p>Search the full provider catalog with the same combined picker used on the canvas.</p>
            <SearchableModelSelect
              value={selectedModelVariantId}
              options={modelVariants}
              onChange={(variant) => {
                setSelectedModelVariantId(variant.id);
              }}
            />
          </section>
        ) : null}

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              setPlaygroundSeed((current) => current + 1);
            }}
          >
            Reset Playground
          </button>
        </div>
      </aside>

      <section className={styles.playgroundCard}>
        <header className={styles.playgroundHeader}>
          <div>
            <h2>Interactive Playground</h2>
            <p>The right side uses the actual canvas node renderers and editing surfaces.</p>
          </div>
        </header>

        <div className={styles.canvasFrame}>
          <NodePlaygroundCanvas
            key={`${entry.id}-${playgroundSeed}`}
            fixture={fixture}
            providerModels={providers}
            selectedModelVariantId={selectedModelVariantId}
            onModelVariantChange={setSelectedModelVariantId}
          />
        </div>
      </section>
    </main>
  );
}
