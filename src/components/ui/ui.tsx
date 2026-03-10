"use client";

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { computeAnchoredOverlayPosition, type AnchoredOverlayPlacement } from "@/lib/anchored-overlay";
import {
  buildUiDataAttributes,
  normalizeUiDensity,
  normalizeUiSurface,
  resolveBadgeVariant,
  resolveButtonSize,
  resolveButtonVariant,
  resolvePanelVariant,
} from "@/lib/design-system";
import type {
  UiBadgeVariant,
  UiButtonSize,
  UiButtonVariant,
  UiDensity,
  UiPanelVariant,
  UiSurface,
} from "@/styles/design-system/contracts";
import styles from "./ui.module.css";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type BaseProps = {
  surface?: UiSurface;
  density?: UiDensity;
  className?: string;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  ref.current = value;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  BaseProps & {
    variant?: UiButtonVariant;
    size?: UiButtonSize;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, surface, density, className, type = "button", ...props },
  ref
) {
  const resolvedSurface = normalizeUiSurface(surface);
  const resolvedDensity = normalizeUiDensity(density);

  return (
    <button
      {...props}
      {...buildUiDataAttributes(resolvedSurface, resolvedDensity)}
      ref={ref}
      type={type}
      data-variant={resolveButtonVariant(variant)}
      data-size={resolveButtonSize(size)}
      className={cx(styles.button, className)}
    />
  );
});

type PanelProps = HTMLAttributes<HTMLElement> &
  BaseProps & {
    as?: "div" | "section" | "article" | "aside" | "header" | "main";
    variant?: UiPanelVariant;
  };

export function Panel({
  as = "section",
  variant,
  surface,
  density,
  className,
  ...props
}: PanelProps) {
  const Component = as;
  const resolvedSurface = normalizeUiSurface(surface);
  const resolvedDensity = normalizeUiDensity(density);

  return (
    <Component
      {...props}
      {...buildUiDataAttributes(resolvedSurface, resolvedDensity)}
      data-variant={resolvePanelVariant(variant)}
      data-density={resolvedDensity}
      className={cx(styles.panel, className)}
    />
  );
}

export const Card = Panel;

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  BaseProps & {
    variant?: UiBadgeVariant;
  };

export function Badge({ variant, surface, density, className, ...props }: BadgeProps) {
  const resolvedSurface = normalizeUiSurface(surface);
  const resolvedDensity = normalizeUiDensity(density);

  return (
    <span
      {...props}
      {...buildUiDataAttributes(resolvedSurface, resolvedDensity)}
      data-variant={resolveBadgeVariant(variant)}
      className={cx(styles.badge, className)}
    />
  );
}

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> &
  BaseProps & {
    eyebrow?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
  };

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  surface,
  density,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      className={cx(styles.sectionHeader, className)}
    >
      <div className={styles.sectionHeaderCopy}>
        {eyebrow ? <div className={styles.sectionHeaderEyebrow}>{eyebrow}</div> : null}
        <h2 className={styles.sectionHeaderTitle}>{title}</h2>
        {description ? <p className={styles.sectionHeaderDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.sectionHeaderActions}>{actions}</div> : null}
    </div>
  );
}

type FieldProps = HTMLAttributes<HTMLLabelElement> &
  BaseProps & {
    label: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    htmlFor?: string;
  };

export function Field({
  label,
  description,
  error,
  surface,
  density,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <label
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      className={cx(styles.field, className)}
    >
      <span className={styles.fieldHeader}>
        <span className={styles.fieldLabel}>{label}</span>
        {description ? <span className={styles.fieldMeta}>{description}</span> : null}
      </span>
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & BaseProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { surface, density, className, ...props },
  ref
) {
  return (
    <input
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      ref={ref}
      className={cx(styles.input, className)}
    />
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & BaseProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { surface, density, className, ...props },
  ref
) {
  return (
    <textarea
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      ref={ref}
      className={cx(styles.textarea, className)}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & BaseProps;

export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField(
  { surface, density, className, children, ...props },
  ref
) {
  return (
    <select
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      ref={ref}
      className={cx(styles.select, className)}
    >
      {children}
    </select>
  );
});

type EmptyStateProps = HTMLAttributes<HTMLDivElement> &
  BaseProps & {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
  };

export function EmptyState({
  title,
  description,
  action,
  surface,
  density,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      className={cx(styles.emptyState, className)}
    >
      <h3 className={styles.emptyStateTitle}>{title}</h3>
      {description ? <p className={styles.emptyStateDescription}>{description}</p> : null}
      {action}
    </div>
  );
}

type ToolbarGroupProps = HTMLAttributes<HTMLDivElement> &
  BaseProps & {
    align?: "start" | "end" | "split";
  };

export function ToolbarGroup({
  align = "start",
  surface,
  density,
  className,
  ...props
}: ToolbarGroupProps) {
  return (
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      data-align={align}
      className={cx(styles.toolbarGroup, className)}
    />
  );
}

type SurfaceShellProps = HTMLAttributes<HTMLDivElement> & BaseProps;

export function PopoverSurface({ surface, density, className, ...props }: SurfaceShellProps) {
  return (
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      className={cx(styles.popoverSurface, className)}
    />
  );
}

export function ModalSurface({ surface, density, className, ...props }: SurfaceShellProps) {
  return (
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      className={cx(styles.modalSurface, className)}
    />
  );
}

type AnchoredOverlayProps = HTMLAttributes<HTMLDivElement> &
  BaseProps & {
    open: boolean;
    anchorEl: HTMLElement | null;
    onRequestClose?: () => void;
    preferredPlacement?: AnchoredOverlayPlacement;
    offset?: number;
    viewportPadding?: number;
    minHeight?: number;
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    matchAnchorWidth?: boolean;
    closeOnEscape?: boolean;
    closeOnInteractOutside?: boolean;
  };

export const AnchoredOverlay = forwardRef<HTMLDivElement, AnchoredOverlayProps>(function AnchoredOverlay(
  {
    open,
    anchorEl,
    onRequestClose,
    preferredPlacement = "bottom-start",
    offset = 10,
    viewportPadding = 14,
    minHeight = 180,
    width,
    minWidth,
    maxWidth,
    matchAnchorWidth = false,
    closeOnEscape = true,
    closeOnInteractOutside = true,
    surface,
    density,
    className,
    style,
    children,
    ...props
  },
  ref
) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [positionStyle, setPositionStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPositionStyle(null);
      return;
    }

    const updatePosition = () => {
      if (!anchorEl.isConnected) {
        setPositionStyle(null);
        onRequestClose?.();
        return;
      }

      const rect = anchorEl.getBoundingClientRect();
      const nextPosition = computeAnchoredOverlayPosition({
        anchorRect: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          width: rect.width,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        preferredPlacement,
        offset,
        viewportPadding,
        minHeight,
        width,
        minWidth,
        maxWidth,
        matchAnchorWidth,
      });

      setPositionStyle({
        left: nextPosition.left,
        width: nextPosition.width,
        maxHeight: nextPosition.maxHeight,
        ...(nextPosition.top !== undefined ? { top: nextPosition.top } : {}),
        ...(nextPosition.bottom !== undefined ? { bottom: nextPosition.bottom } : {}),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updatePosition();
          })
        : null;
    resizeObserver?.observe(anchorEl);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [
    anchorEl,
    matchAnchorWidth,
    maxWidth,
    minHeight,
    minWidth,
    offset,
    onRequestClose,
    open,
    preferredPlacement,
    viewportPadding,
    width,
  ]);

  useEffect(() => {
    if (!open || !closeOnInteractOutside) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (overlayRef.current?.contains(target) || anchorEl?.contains(target)) {
        return;
      }

      onRequestClose?.();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [anchorEl, closeOnInteractOutside, onRequestClose, open]);

  useEffect(() => {
    if (!open || !closeOnEscape) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onRequestClose?.();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeOnEscape, onRequestClose, open]);

  if (!open || !anchorEl || !positionStyle) {
    return null;
  }

  return createPortal(
    <div
      {...props}
      {...buildUiDataAttributes(normalizeUiSurface(surface), normalizeUiDensity(density))}
      ref={(node) => {
        overlayRef.current = node;
        assignRef(ref, node);
      }}
      className={cx(styles.anchoredOverlay, className)}
      style={{
        ...positionStyle,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body
  );
});
