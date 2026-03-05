"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getJobDebug, getJobs, openProject } from "@/components/workspace/client-api";
import type { Job, JobAttemptDebug, JobDebugResponse } from "@/components/workspace/types";
import styles from "./queue-view.module.css";

type Props = {
  projectId: string;
};

const stateOptions = ["all", "queued", "running", "succeeded", "failed", "canceled"] as const;
type StateFilter = (typeof stateOptions)[number];

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || durationMs === undefined) {
    return "-";
  }
  return `${durationMs}ms`;
}

function renderJson(value: Record<string, unknown> | null) {
  if (!value) {
    return "-";
  }
  return JSON.stringify(value, null, 2);
}

function attemptLabel(attempt: JobAttemptDebug) {
  const pieces: string[] = [`Attempt ${attempt.attemptNumber}`];
  if (attempt.errorCode || attempt.errorMessage) {
    pieces.push("failed");
  } else if (attempt.providerResponse) {
    pieces.push("succeeded");
  }
  return pieces.join(" · ");
}

export function QueueView({ projectId }: Props) {
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [loading, setLoading] = useState(true);
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [jobDebug, setJobDebug] = useState<JobDebugResponse | null>(null);

  const refreshJobs = useCallback(async () => {
    const nextJobs = await getJobs(projectId);
    setJobs(nextJobs);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);

    Promise.all([refreshJobs(), openProject(projectId)])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, refreshJobs]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshJobs().catch(console.error);
    }, 2500);

    return () => clearInterval(interval);
  }, [refreshJobs]);

  useEffect(() => {
    const inspectFromQuery = searchParams.get("inspectJobId");
    if (inspectFromQuery) {
      setInspectJobId(inspectFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!inspectJobId) {
      setJobDebug(null);
      setInspectError(null);
      return;
    }

    setInspectLoading(true);
    getJobDebug(projectId, inspectJobId)
      .then((response) => {
        setJobDebug(response);
        setInspectError(null);
      })
      .catch((error) => {
        setJobDebug(null);
        setInspectError(error instanceof Error ? error.message : "Failed to inspect job.");
      })
      .finally(() => {
        setInspectLoading(false);
      });
  }, [inspectJobId, projectId]);

  const visibleJobs = useMemo(() => {
    if (stateFilter === "all") {
      return jobs;
    }

    return jobs.filter((job) => job.state === stateFilter);
  }, [jobs, stateFilter]);

  const latestAttempt = jobDebug?.attempts[0] || null;

  return (
    <WorkspaceShell projectId={projectId} view="queue" jobs={jobs}>
      <main className={styles.page}>
        <section className={styles.panel}>
          <header className={styles.header}>
            <h1>Queue</h1>

            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}>
              {stateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </header>

          {loading ? (
            <div className={styles.loading}>Loading queue...</div>
          ) : (
            <div className={styles.content}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Actions</th>
                      <th>State</th>
                      <th>Node</th>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Queued</th>
                      <th>Started</th>
                      <th>Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleJobs.map((job) => (
                      <tr key={job.id} className={inspectJobId === job.id ? styles.jobActive : ""}>
                        <td>
                          <button type="button" className={styles.inspectButton} onClick={() => setInspectJobId(job.id)}>
                            Inspect Call
                          </button>
                        </td>
                        <td>
                          <span className={`${styles.state} ${styles[`state_${job.state}`] || ""}`}>{job.state}</span>
                        </td>
                        <td>{job.nodeRunPayload?.nodeId || "-"}</td>
                        <td>{job.providerId}</td>
                        <td>{job.modelId}</td>
                        <td>{formatDate(job.createdAt)}</td>
                        <td>{formatDate(job.startedAt)}</td>
                        <td>{formatDate(job.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {visibleJobs.length === 0 && <div className={styles.empty}>No jobs in this state.</div>}
              </div>

              <aside className={styles.inspectPane}>
                <h2>Call Inspector</h2>

                {!inspectJobId ? (
                  <div className={styles.inspectEmpty}>Select a queue row and click Inspect Call.</div>
                ) : inspectLoading ? (
                  <div className={styles.inspectEmpty}>Loading call details...</div>
                ) : inspectError ? (
                  <div className={styles.inspectError}>{inspectError}</div>
                ) : !jobDebug ? (
                  <div className={styles.inspectEmpty}>No debug details found.</div>
                ) : (
                  <>
                    <dl className={styles.inspectMeta}>
                      <div>
                        <dt>Job</dt>
                        <dd>{jobDebug.job.id}</dd>
                      </div>
                      <div>
                        <dt>State</dt>
                        <dd>{jobDebug.job.state}</dd>
                      </div>
                      <div>
                        <dt>Provider</dt>
                        <dd>{jobDebug.job.providerId}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{jobDebug.job.modelId}</dd>
                      </div>
                      <div>
                        <dt>Attempts</dt>
                        <dd>{jobDebug.attempts.length}</dd>
                      </div>
                    </dl>

                    <section className={styles.inspectSection}>
                      <h3>Latest Request</h3>
                      <pre>{renderJson(latestAttempt?.providerRequest || null)}</pre>
                    </section>

                    <section className={styles.inspectSection}>
                      <h3>Latest Response</h3>
                      <pre>{renderJson(latestAttempt?.providerResponse || null)}</pre>
                    </section>

                    <section className={styles.inspectSection}>
                      <h3>Latest Error</h3>
                      <pre>
                        {latestAttempt?.errorCode || latestAttempt?.errorMessage
                          ? `${latestAttempt.errorCode || "ERROR"}: ${latestAttempt.errorMessage || "Unknown error"}`
                          : "-"}
                      </pre>
                    </section>

                    <section className={styles.inspectSection}>
                      <h3>Attempt History</h3>
                      <ul className={styles.attemptList}>
                        {jobDebug.attempts.map((attempt) => (
                          <li key={attempt.id}>
                            <strong>{attemptLabel(attempt)}</strong>
                            <span>{formatDate(attempt.createdAt)}</span>
                            <span>{formatDuration(attempt.durationMs)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                )}
              </aside>
            </div>
          )}
        </section>
      </main>
    </WorkspaceShell>
  );
}
