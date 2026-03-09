"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProviders } from "@/components/workspace/client-api";
import type { ProviderModel } from "@/components/workspace/types";
import { getNodeCatalogEntries } from "@/lib/node-catalog";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppHomeRoute,
  buildAppSettingsRoute,
  buildNodeLibraryDetailRoute,
} from "@/renderer/workspace-route";
import styles from "./node-library-view.module.css";

export function NodeLibraryView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: providers = [] } = useQuery<ProviderModel[]>({
    queryKey: queryKeys.providers,
    queryFn: getProviders,
  });

  const entries = useMemo(() => getNodeCatalogEntries(providers), [providers]);
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = [
        entry.label,
        entry.shortDescription,
        entry.category,
        entry.inputSummary,
        entry.outputSummary,
        entry.variantHint || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [entries, query]);

  const providerCount = new Set(providers.map((provider) => provider.providerId)).size;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCard}>
          <div className={styles.kicker}>Node Registry</div>
          <h1>Node Library</h1>
          <p>
            Browse the canonical node catalog, inspect real node behavior, and use the detail pages as
            design/debug playgrounds for every built-in node type.
          </p>

          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                router.push(buildAppHomeRoute());
              }}
            >
              Back Home
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                router.push(buildAppSettingsRoute());
              }}
            >
              App Settings
            </button>
          </div>
        </div>

        <div className={styles.searchCard}>
          <div className={styles.kicker}>Search</div>
          <p>
            The gallery, insert picker, native add menus, model chooser, and prompt harness all pull from
            the same catalog now.
          </p>
          <input
            className={styles.searchField}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search node names, categories, or I/O"
          />

          <div className={styles.metricGrid}>
            <div className={styles.metric}>
              <span>Built-ins</span>
              <strong>{entries.length}</strong>
            </div>
            <div className={styles.metric}>
              <span>Providers</span>
              <strong>{providerCount || "…"}</strong>
            </div>
            <div className={styles.metric}>
              <span>Model Variants</span>
              <strong>{providers.length || "…"}</strong>
            </div>
            <div className={styles.metric}>
              <span>Insertable</span>
              <strong>{entries.filter((entry) => entry.insertableOnCanvas).length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.gallerySection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Built-In Nodes</h2>
            <p>Every card opens a detail page with the real canvas renderer and an ephemeral playground.</p>
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className={styles.empty}>No node types match that search.</div>
        ) : (
          <div className={styles.cardGrid}>
            {filteredEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={styles.card}
                onClick={() => {
                  router.push(buildNodeLibraryDetailRoute(entry.id));
                }}
              >
                <div className={styles.cardHeader}>
                  <div>
                    <h3>{entry.label}</h3>
                    <p>{entry.shortDescription}</p>
                  </div>
                  <span className={styles.category}>{entry.category}</span>
                </div>

                <div className={styles.metaRow}>
                  <span className={styles.metaPill}>{entry.inputSummary}</span>
                  <span className={styles.metaPill}>{entry.outputSummary}</span>
                  {entry.variantHint ? <span className={styles.metaPill}>{entry.variantHint}</span> : null}
                </div>

                <div className={styles.metaRow}>
                  {entry.supportedDisplayModes.map((mode) => (
                    <span key={`${entry.id}-${mode}`} className={styles.metaPill}>
                      {mode}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
