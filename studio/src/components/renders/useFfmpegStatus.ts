import type { NativeRuntimeStatus } from '../../../../shared/native-runtime';
import { useCallback, useEffect, useRef, useState } from "react";
import { studioApiFetch } from "../../utils/studioApiFetch";

export interface RenderWorkerHealthEntry {
  workerId: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  chromium: boolean;
  concurrency: number;
  activeJobs: number;
  updatedAt: number;
}

/**
 * Render worker FFmpeg/Chromium readiness as reported by `GET /api/environment/ffmpeg`
 * (backed by Redis `om:workers:render:health` worker-render heartbeats in cloud mode).
 */
export interface FfmpegStatus {
  ok: boolean;
  available?: boolean;
  mode?: string;
  version?: string | null;
  workers?: RenderWorkerHealthEntry[];
  runtime?: NativeRuntimeStatus;
  runtimeUnavailable?: boolean;
  /** Short headline, e.g. "Render worker unavailable" or "FFmpeg not found". Absent when ok. */
  title?: string;
  /** Why it cannot run, in the server's words. Absent when ok. */
  detail?: string;
  /** Prose remediation, including the manual route where one exists. */
  hint?: string;
  /** A single pasteable install command, when a local host has one. */
  command?: string;
}

/**
 * `null` means "no answer", NOT "missing". An unreachable or older server
 * is not evidence that rendering is absent, and blocking Export on a failed probe
 * would lock out people whose setup is fine. Unknown always fails open.
 */
type ProbeResult = FfmpegStatus | null;

/**
 * One line naming the problem and the fix, for the render row Studio writes
 * when it refuses to start.
 */
export function ffmpegInstallMessage(status: FfmpegStatus | null): string {
  if (status?.mode === 'remote-worker') {
    return status.detail ?? 'Render worker is currently offline. Export will resume once worker-render reports a healthy heartbeat.';
  }
  const title = status?.title ?? "FFmpeg not found";
  const remedy = status?.command ?? status?.hint;
  return remedy ? `${title}. Install it with: ${remedy}` : `${title}. Install FFmpeg to export.`;
}

let cached: ProbeResult = null;

const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** Parses `/api/environment/ffmpeg`, supporting both cloud worker-render heartbeat and legacy payloads. */
function parseStatus(body: unknown): ProbeResult {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const ok = typeof record.ok === "boolean"
    ? record.ok
    : typeof record.available === "boolean"
      ? record.available
      : null;
  if (ok === null) return null;
  const mode = asText(record.mode);
  const workers = Array.isArray(record.workers) ? (record.workers as RenderWorkerHealthEntry[]) : undefined;
  const version = typeof record.version === "string" ? record.version : null;

  if (!ok && mode === "remote-worker") {
    return {
      ok: false,
      available: false,
      mode,
      version,
      workers,
      title: asText(record.title) ?? "Render worker unavailable",
      detail: asText(record.detail) ?? "No healthy render worker heartbeat is currently reported.",
      hint: asText(record.hint) ?? "Check that the worker-render container is running, then click Recheck.",
    };
  }

  return {
    ok,
    available: ok,
    mode,
    version,
    workers,
    title: asText(record.title),
    detail: asText(record.detail),
    hint: asText(record.hint),
    command: asText(record.command),
  };
}

async function probe(): Promise<ProbeResult> {
  try {
    const res = await studioApiFetch("/api/environment/ffmpeg");
    return res.ok ? parseStatus(await res.json()) : null;
  } catch {
    return null;
  }
}

export function useFfmpegStatus(): {
  status: ProbeResult;
  checking: boolean;
  recheck: (retry?: boolean) => void;
} {
  const [status, setStatus] = useState<ProbeResult>(cached);
  const [checking, setChecking] = useState(cached === null);
  const mounted = useRef(true);
  const latestProbe = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const request = ++latestProbe.current;
    setChecking(true);
    const next = await probe();
    if (request !== latestProbe.current) return;
    cached = next;
    if (!mounted.current) return;
    setStatus(next);
    setChecking(false);
  }, []);

  useEffect(() => {
    void run();
    const refresh = () => { void run(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [run]);

  const recheck = useCallback((_retry = true) => {
    void run();
  }, [run]);

  return { status, checking, recheck };
}
