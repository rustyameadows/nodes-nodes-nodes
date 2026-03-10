"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnchoredOverlay, Button, Input, PopoverSurface } from "@/components/ui";
import { buildUiDataAttributes, normalizeUiDensity, normalizeUiSurface } from "@/lib/design-system";
import {
  filterModelVariants,
  getInitialActiveModelVariantId,
  getNextActiveModelVariantId,
  groupModelVariants,
} from "@/lib/model-variant-select";
import { formatModelVariantLabel, type NodeCatalogVariant } from "@/lib/node-catalog";
import type { UiDensity, UiSurface } from "@/styles/design-system/contracts";
import styles from "./searchable-model-select.module.css";

type Props = {
  value: string | null;
  options: NodeCatalogVariant[];
  disabled?: boolean;
  surface?: UiSurface;
  density?: UiDensity;
  dismissKey?: string | number | null;
  onOpenChange?: (open: boolean) => void;
  onChange: (variant: NodeCatalogVariant) => void;
};

function statusClassName(status: NodeCatalogVariant["status"]) {
  if (status === "ready") {
    return styles.statusReady;
  }
  if (status === "missing_key" || status === "temporarily_limited") {
    return styles.statusMissing;
  }
  if (status === "unverified") {
    return styles.statusWarn;
  }
  return styles.statusSoon;
}

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

export function SearchableModelSelect({
  value,
  options,
  disabled = false,
  surface,
  density,
  dismissKey,
  onOpenChange,
  onChange,
}: Props) {
  const resolvedSurface = normalizeUiSurface(surface);
  const resolvedDensity = normalizeUiDensity(density);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previousDismissKeyRef = useRef<string | number | null | undefined>(dismissKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);

  const selectedVariant = useMemo(
    () => options.find((option) => option.id === value) || options[0] || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => filterModelVariants(options, query), [options, query]);
  const groupedOptions = useMemo(() => groupModelVariants(filteredOptions), [filteredOptions]);
  const flatOptions = useMemo(() => groupedOptions.flatMap((group) => group.options), [groupedOptions]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveOptionId(null);
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
      previousDismissKeyRef.current = dismissKey;
      return;
    }

    if (previousDismissKeyRef.current !== dismissKey) {
      setOpen(false);
    }
    previousDismissKeyRef.current = dismissKey;
  }, [dismissKey, open]);

  useEffect(() => {
    if (!open || !disabled) {
      return;
    }
    setOpen(false);
  }, [disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveOptionId((current) => {
      if (current && flatOptions.some((option) => option.id === current && !option.disabled)) {
        return current;
      }
      return getInitialActiveModelVariantId(flatOptions, selectedVariant?.id || null);
    });
  }, [flatOptions, open, selectedVariant?.id]);

  useEffect(() => {
    if (!open || !activeOptionId) {
      return;
    }

    optionRefs.current[activeOptionId]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeOptionId, open]);

  const selectOption = (option: NodeCatalogVariant) => {
    if (option.disabled) {
      return;
    }
    onChange(option);
    setOpen(false);
  };

  const handleKeyboardNavigation = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (!open) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveOptionId((current) => getNextActiveModelVariantId(flatOptions, current, 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveOptionId((current) => getNextActiveModelVariantId(flatOptions, current, -1));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveOptionId(getInitialActiveModelVariantId(flatOptions, null));
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveOptionId(getNextActiveModelVariantId(flatOptions, null, -1));
      return;
    }

    if (event.key === "Enter" && activeOptionId) {
      const option = flatOptions.find((candidate) => candidate.id === activeOptionId);
      if (option && !option.disabled) {
        event.preventDefault();
        selectOption(option);
      }
    }
  };

  return (
    <div
      {...buildUiDataAttributes(resolvedSurface, resolvedDensity)}
      className={styles.root}
    >
      <Button
        ref={triggerRef}
        surface={resolvedSurface}
        density={resolvedDensity}
        variant="secondary"
        className={styles.trigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onPointerDown={stopPointer}
        onKeyDown={handleKeyboardNavigation}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className={styles.triggerLabel}>
          <strong>{selectedVariant ? formatModelVariantLabel(selectedVariant) : "Select a model"}</strong>
          <span>{selectedVariant ? `${selectedVariant.modelId} · ${selectedVariant.availabilityLabel}` : "No model available"}</span>
        </span>
        <span className={styles.triggerCaret}>{open ? "▴" : "▾"}</span>
      </Button>

      <AnchoredOverlay
        open={open}
        anchorEl={triggerRef.current}
        onRequestClose={() => {
          setOpen(false);
        }}
        surface={resolvedSurface}
        density={resolvedDensity}
        preferredPlacement="bottom-start"
        offset={8}
        viewportPadding={resolvedSurface === "canvas-overlay" ? 12 : 16}
        minHeight={220}
        minWidth={resolvedSurface === "canvas-overlay" ? 320 : 360}
        maxWidth={resolvedSurface === "canvas-overlay" ? 520 : 620}
        matchAnchorWidth
        className={styles.overlay}
      >
        <PopoverSurface
          surface={resolvedSurface}
          density={resolvedDensity}
          className={styles.panel}
          onPointerDown={stopPointer}
          onKeyDown={handleKeyboardNavigation}
        >
          <Input
            ref={searchInputRef}
            surface={resolvedSurface}
            density={resolvedDensity}
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyboardNavigation}
            onPointerDown={stopPointer}
            placeholder="Search provider or model"
            aria-activedescendant={activeOptionId ? `model-option-${activeOptionId}` : undefined}
          />

          <div className={styles.groups} role="listbox" aria-activedescendant={activeOptionId ? `model-option-${activeOptionId}` : undefined}>
            {groupedOptions.length === 0 ? (
              <div className={styles.empty}>No models match that search.</div>
            ) : (
              groupedOptions.map((group) => (
                <section key={group.providerLabel} className={styles.group}>
                  <div className={styles.groupTitle}>{group.providerLabel}</div>
                  {group.options.map((option) => {
                    const isActive = option.id === activeOptionId;
                    const isSelected = option.id === selectedVariant?.id;

                    return (
                      <button
                        key={option.id}
                        id={`model-option-${option.id}`}
                        ref={(node) => {
                          optionRefs.current[option.id] = node;
                        }}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-active={isActive ? "true" : "false"}
                        className={`${styles.option} ${isSelected ? styles.optionActive : ""} ${
                          isActive ? styles.optionKeyboardActive : ""
                        } ${option.disabled ? styles.optionDisabled : ""}`}
                        onPointerDown={stopPointer}
                        onMouseEnter={() => {
                          if (!option.disabled) {
                            setActiveOptionId(option.id);
                          }
                        }}
                        disabled={option.disabled}
                        title={option.disabledReason || undefined}
                        onClick={() => {
                          selectOption(option);
                        }}
                      >
                        <span className={styles.optionCopy}>
                          <strong>{option.label}</strong>
                          <span>{option.modelId}</span>
                        </span>
                        <span className={statusClassName(option.status)}>{option.availabilityLabel}</span>
                      </button>
                    );
                  })}
                </section>
              ))
            )}
          </div>
        </PopoverSurface>
      </AnchoredOverlay>
    </div>
  );
}
