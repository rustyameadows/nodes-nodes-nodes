import type { NodeCatalogVariant } from "@/lib/node-catalog";

export type GroupedModelVariants = {
  providerLabel: string;
  options: NodeCatalogVariant[];
};

export function filterModelVariants(options: NodeCatalogVariant[], query: string) {
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
}

export function groupModelVariants(options: NodeCatalogVariant[]): GroupedModelVariants[] {
  const groups = new Map<string, NodeCatalogVariant[]>();

  for (const option of options) {
    const current = groups.get(option.providerLabel) || [];
    current.push(option);
    groups.set(option.providerLabel, current);
  }

  return Array.from(groups.entries()).map(([providerLabel, groupedOptions]) => ({
    providerLabel,
    options: groupedOptions,
  }));
}

export function getNavigableModelVariants(options: NodeCatalogVariant[]) {
  return options.filter((option) => !option.disabled);
}

export function getInitialActiveModelVariantId(options: NodeCatalogVariant[], selectedId: string | null) {
  const navigableOptions = getNavigableModelVariants(options);
  if (navigableOptions.length === 0) {
    return null;
  }

  return navigableOptions.find((option) => option.id === selectedId)?.id || navigableOptions[0]!.id;
}

export function getNextActiveModelVariantId(
  options: NodeCatalogVariant[],
  currentId: string | null,
  direction: 1 | -1
) {
  const navigableOptions = getNavigableModelVariants(options);
  if (navigableOptions.length === 0) {
    return null;
  }

  const currentIndex = currentId ? navigableOptions.findIndex((option) => option.id === currentId) : -1;
  if (currentIndex === -1) {
    return direction > 0 ? navigableOptions[0]!.id : navigableOptions[navigableOptions.length - 1]!.id;
  }

  const nextIndex = (currentIndex + direction + navigableOptions.length) % navigableOptions.length;
  return navigableOptions[nextIndex]!.id;
}
