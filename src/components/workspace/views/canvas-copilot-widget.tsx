"use client";

import { useEffect, useRef } from "react";
import { SearchableModelSelect } from "@/components/searchable-model-select";
import type { CanvasCopilotMessage } from "@/lib/canvas-copilot";
import type { NodeCatalogVariant } from "@/lib/node-catalog";
import styles from "./canvas-copilot-widget.module.css";

type Props = {
  open: boolean;
  modelVariantId: string | null;
  modelOptions: NodeCatalogVariant[];
  draft: string;
  messages: CanvasCopilotMessage[];
  isRunning: boolean;
  disabledReason: string | null;
  readyMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onModelVariantChange: (variantId: string) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
};

export function CanvasCopilotWidget({
  open,
  modelVariantId,
  modelOptions,
  draft,
  messages,
  isRunning,
  disabledReason,
  readyMessage,
  onOpenChange,
  onModelVariantChange,
  onDraftChange,
  onSubmit,
}: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const statusTone = disabledReason ? "blocked" : readyMessage ? "ready" : "neutral";
  const footerMessage =
    disabledReason || readyMessage || "Select a runnable text model to enable Send.";

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      composerRef.current?.focus();
    }, 24);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pill}
        onFocus={() => onOpenChange(true)}
        onClick={() => onOpenChange(true)}
      >
        <span className={styles.pillLabel}>Node Bot</span>
      </button>
    );
  }

  return (
    <aside
      className={styles.panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onOpenChange(false);
        }
      }}
    >
      <div className={styles.header}>
        <span className={styles.eyebrow}>Canvas Copilot</span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.minimizeButton}
            onClick={() => onOpenChange(false)}
          >
            Minimize
          </button>
        </div>
      </div>

      <div className={styles.modelRow}>
        <SearchableModelSelect
          surface="canvas-overlay"
          density="compact"
          triggerTone="model-node"
          value={modelVariantId}
          options={modelOptions}
          disabled={modelOptions.length === 0 || isRunning}
          onChange={(variant) => {
            onModelVariantChange(variant.id);
          }}
        />
      </div>

      <div ref={transcriptRef} className={styles.transcript}>
        {messages.length > 0
          ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`${styles.message} ${message.role === "user" ? styles.messageUser : styles.messageSystem}`}
              >
                <span className={styles.messageMeta}>{message.role === "user" ? "You" : "Node Bot"}</span>
                <div
                  className={`${styles.messageBody} ${
                    message.role === "user" ? styles.messageUserBody : styles.messageSystemBody
                  } ${
                    message.state === "error"
                      ? styles.messageError
                      : message.state === "success"
                        ? styles.messageSuccess
                        : message.state === "pending"
                          ? styles.messagePending
                          : ""
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))
          )
          : null}
      </div>

      <div className={styles.composer}>
        <textarea
          ref={composerRef}
          className={styles.input}
          rows={5}
          value={draft}
          disabled={isRunning}
          placeholder="Describe the nodes you want on the canvas..."
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>

      <div className={styles.composerFooter}>
        <div
          className={`${styles.footerStatus} ${
            statusTone === "blocked"
              ? styles.footerStatusBlocked
              : statusTone === "ready"
                ? styles.footerStatusReady
                : styles.footerStatusNeutral
          }`}
        >
          {footerMessage}
        </div>
        <button
          type="button"
          className={styles.sendButton}
          disabled={isRunning || Boolean(disabledReason) || draft.trim().length === 0}
          onClick={onSubmit}
        >
          Send
        </button>
      </div>
    </aside>
  );
}
