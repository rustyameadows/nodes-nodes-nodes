"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeCatalogVariant } from "@/lib/node-catalog";
import { formatModelVariantLabel } from "@/lib/node-catalog";
import styles from "./searchable-model-select.module.css";

type Props = {
  value: string | null;
  options: NodeCatalogVariant[];
  disabled?: boolean;
  onChange: (variant: NodeCatalogVariant) => void;
};

function statusClassName(status: NodeCatalogVariant["status"]) {
  if (status === "ready") {
    return styles.statusReady;
  }
  if (status === "missing_key") {
    return styles.statusMissing;
  }
  return styles.statusSoon;
}

export function SearchableModelSelect({ value, options, disabled = false, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedVariant = useMemo(
    () => options.find((option) => option.id === value) || options[0] || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return options;
    }

    return options.filter((option) => {
      const haystack = [
        option.providerLabel,
        option.label,
        option.modelId,
        option.description,
        option.availabilityLabel,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [options, query]);

  const groupedOptions = useMemo(() => {
    return filteredOptions.reduce<Record<string, NodeCatalogVariant[]>>((acc, option) => {
      acc[option.providerLabel] = acc[option.providerLabel] || [];
      acc[option.providerLabel].push(option);
      return acc;
    }, {});
  }, [filteredOptions]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className={styles.triggerLabel}>
          <strong>{selectedVariant ? formatModelVariantLabel(selectedVariant) : "Select a model"}</strong>
          <span>{selectedVariant ? `${selectedVariant.modelId} · ${selectedVariant.availabilityLabel}` : "No model available"}</span>
        </span>
        <span className={styles.triggerCaret}>{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className={styles.panel}>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            placeholder="Search provider or model"
          />

          <div className={styles.groups}>
            {Object.entries(groupedOptions).length === 0 ? (
              <div className={styles.empty}>No models match that search.</div>
            ) : (
              Object.entries(groupedOptions).map(([providerLabel, providerOptions]) => (
                <section key={providerLabel} className={styles.group}>
                  <div className={styles.groupTitle}>{providerLabel}</div>
                  {providerOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`${styles.option} ${option.id === selectedVariant?.id ? styles.optionActive : ""}`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.optionCopy}>
                        <strong>{option.label}</strong>
                        <span>{option.modelId}</span>
                      </span>
                      <span className={statusClassName(option.status)}>{option.availabilityLabel}</span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
