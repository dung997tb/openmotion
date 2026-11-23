import { Button } from 'open-design-ui/button';
import { trackStudioClick, trackVersionHistoryResult } from './editorTracking';
import { Tooltip } from "../components/ui/Tooltip";
import { useI18n } from "../i18n/I18n";
import { historyEntryLabel } from '../i18n/historyMessages';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryListItem } from '@hyperframes/studio-server/history';
import { useStudioShellContext } from '../contexts/StudioContext';
import { studioWriteHeaders } from '../utils/studioFileVersion';
import { useCloudDisklessMode } from '../utils/cloudRuntime';
import { MotionIcon } from './icons';
import { useMotionHistoryOperation } from './MotionHistoryState';
import { subscribeProjectActivity } from './workspaceRefresh';

type PanelEntry = Pick<HistoryListItem, 'id' | 'label' | 'who' | 'pinned' | 'undone' | 'restoredTo'> & {
  endedAt: number | string;
  seq?: number;
  files: Array<{ path: string; before?: string | null; after?: string | null; status?: 'added' | 'deleted' | 'modified' }>;
};
interface HistoryResponse { entries: PanelEntry[]; currentSeq?: number }

export async function historyRequest<T>(projectId: string, action = '', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history${action}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json', ...studioWriteHeaders() }, body: JSON.stringify(body) } : {}),
    signal,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || 'Could not read version history');
  return data as T;
}

const reloadProject = () => window.location.reload();

/** Reads and restores Studio's own history; no parallel snapshot store or undo stack. */
type HistoryPanelProps = { onRestored?: () => void; compact?: boolean; allowPinning?: boolean };
export function MotionHistoryPanel(props: HistoryPanelProps) {
  const { projectId } = useStudioShellContext();
  return <ProjectHistoryPanel key={projectId} {...props} />;
}

function ProjectHistoryPanel({ onRestored = reloadProject, compact = false, allowPinning = true }: HistoryPanelProps) {
  const { t, formatDate } = useI18n();
  const { projectId, waitForPendingDomEditSaves, writeBlockedReason, renderQueue, showToast } = useStudioShellContext();
  const historyOperation = useMotionHistoryOperation();
  const cloud = useCloudDisklessMode();
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  // An absent sequence in a successful response identifies the legacy history server.
  const [currentSeq, setCurrentSeq] = useState<number | null>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const activeRead = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const scheduleRead = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    pending.current = false;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    try {
      const result = await historyRequest<HistoryResponse>(projectId, '', undefined, controller.signal);
      const chronological = result.currentSeq === undefined ? result.entries : [...result.entries].reverse();
      if (!controller.signal.aborted && mounted.current) {
        setEntries(chronological);
        setCurrentSeq(result.currentSeq ?? null);
        setError('');
        setLoading(false);
      }
      return chronological;
    } finally {
      if (activeRead.current === controller) activeRead.current = null;
      if (pending.current && !running.current) scheduleRead.current();
    }
  }, [projectId]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (!pending.current || running.current || activeRead.current) return;
      try { await refresh(); }
      catch (cause) {
        if (mounted.current && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Could not read version history');
          setLoading(false);
        }
      }
    };
    scheduleRead.current = () => {
      pending.current = true;
      if (timer !== undefined || running.current || activeRead.current) return;
      timer = setTimeout(() => { timer = undefined; void read(); }, 75);
    };
    const unsubscribe = subscribeProjectActivity((id, event) => {
      if (id === projectId && (event === 'history-changed' || event === 'connected')) scheduleRead.current();
    });
    pending.current = true;
    void read();
    return () => {
      mounted.current = false; pending.current = false; scheduleRead.current = () => {};
      unsubscribe(); clearTimeout(timer); activeRead.current?.abort();
      activeRead.current = null;
    };
  }, [projectId, refresh]);

  useEffect(() => {
    if (cloud || currentSeq !== null) return;
    const timer = window.setInterval(() => scheduleRead.current(), 3000);
    return () => clearInterval(timer);
  }, [cloud, currentSeq]);

  // An operation returns false when it had nothing to do; only work that happened is reported as a success.
  const run = async (operation: () => Promise<void | boolean>, action?: 'keep_current' | 'pin' | 'unpin' | 'restore') => {
    if (running.current || historyOperation.busy || writeBlockedReason || renderQueue.isRendering) return;
    running.current = true;
    historyOperation.setBusy(true);
    activeRead.current?.abort();
    setBusy(true); setError('');
    try { if (await operation() !== false && action) trackVersionHistoryResult(action, 'success', projectId); }
    catch (cause) { if (action) trackVersionHistoryResult(action, 'failure', projectId); if (mounted.current) showToast(cause instanceof Error ? cause.message : 'Version operation failed', 'error'); }
    finally {
      running.current = false; historyOperation.setBusy(false);
      if (mounted.current) setBusy(false);
      if (pending.current) scheduleRead.current();
    }
  };
  const keepCurrent = () => run(async () => {
    await waitForPendingDomEditSaves();
    await historyRequest(projectId, '/checkpoint', {});
    const current = (await refresh()).at(-1);
    if (!mounted.current) return false;
    if (!current) {
      if (mounted.current) showToast('You can pin a version after your first saved edit.', 'info');
      return false;
    }
    await historyRequest(projectId, '/pin', { entryId: current.id, pinned: true });
    await refresh();
    if (!mounted.current) return;
    setSelectedId(current.id);
    setOnlyPinned(false);
    showToast('Current version pinned', 'info');
  }, 'keep_current');
  const pin = (entry: PanelEntry) => run(async () => {
    await historyRequest(projectId, '/pin', { entryId: entry.id, pinned: !entry.pinned });
    await refresh();
  }, entry.pinned ? 'unpin' : 'pin');
  const restore = (entry: PanelEntry) => run(async () => {
    await waitForPendingDomEditSaves();
    await historyRequest(projectId, '/checkpoint', {});
    await historyRequest(projectId, '/restore', { point: entry.id });
    if (mounted.current) onRestored();
  }, 'restore');

  const shown = [...entries].reverse().filter(entry => !allowPinning || !onlyPinned || entry.pinned);
  const selected = shown.find(entry => entry.id === selectedId) ?? shown[0];
  const disabled = busy || historyOperation.busy || Boolean(writeBlockedReason) || renderQueue.isRendering;
  return <section className="motion-history-panel" aria-label={t("Version history")} aria-busy={busy || loading}>
    {(!compact || allowPinning) && <div className={`motion-history-toolbar${compact ? ' motion-history-toolbar-compact' : ''}`}>
      {!compact && <div><strong>{t("Version history")}</strong><span>{t("Changes are recorded automatically. Pin important versions to keep them.")}</span></div>}
      {allowPinning && <Button variant="plain" type="button" className="motion-button" disabled={disabled || loading} onClick={() => { trackStudioClick('version_history', 'keep_current', projectId); void keepCurrent(); }}>
        <MotionIcon name="save" size={14} />{t("Keep current version")}</Button>}
    </div>}
    {allowPinning && <div className="motion-history-filters" aria-label={t("Filter versions")}>
      <Button variant="plain" type="button" aria-pressed={!onlyPinned} onClick={() => { if (onlyPinned) trackStudioClick('version_history', 'history_filter', projectId, undefined, 'all'); setOnlyPinned(false); }}>{t("All changes")}{" "}<span>{entries.length}</span></Button>
      <Button variant="plain" type="button" aria-pressed={onlyPinned} onClick={() => { if (!onlyPinned) trackStudioClick('version_history', 'history_filter', projectId, undefined, 'pinned'); setOnlyPinned(true); }}>{t("Pinned")}{" "}<span>{entries.filter(entry => entry.pinned).length}</span></Button>
    </div>}
    {(error || writeBlockedReason) && <div className="motion-history-message motion-error" role="alert">
      {t(error || writeBlockedReason || '')}
      {error && <Button variant="plain" type="button" className="motion-button motion-button-quiet" disabled={busy}
        onClick={() => void run(async () => { await refresh(); })}>{t("Try again")}</Button>}
    </div>}
    <div className="motion-history-list" aria-label={t("History entries")}>
      {loading ? <p className="motion-history-empty">{t("Reading versions…")}</p> : !shown.length ? <p className="motion-history-empty">
        {allowPinning && onlyPinned ? t("No pinned versions yet. Select an entry to pin it.") : t("No edits yet")}
      </p> : shown.map(entry => <Button variant="plain" type="button" key={entry.id} className="motion-history-entry"
        aria-pressed={selected?.id === entry.id} onClick={() => { if (selected?.id !== entry.id) trackStudioClick('version_history', 'select_version', projectId); setSelectedId(entry.id); }}>
        <span className="motion-history-entry-heading"><Tooltip label={entry.restoredTo ? t('Restored a previous version') : historyEntryLabel(entry.label, t)} wrap><strong>{entry.restoredTo ? t('Restored a previous version') : historyEntryLabel(entry.label, t)}</strong></Tooltip>
          {allowPinning && entry.pinned && <span className="motion-history-badge">{t("Pinned")}</span>}
          {entry.id === entries.at(-1)?.id && <span className="motion-history-badge motion-history-badge-latest">{t("Latest")}</span>}
        </span>
        <span className="motion-history-entry-meta"><time dateTime={new Date(entry.endedAt).toISOString()}>{formatDate(new Date(entry.endedAt).getTime(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          <span>{entry.who.kind === 'person' ? t("Manual edit") : entry.who.kind === 'agent' ? entry.who.name : t("External change")} · {t('{count} files', { count: entry.files.length })}{entry.undone ? ` · ${t('Undone')}` : ''}</span>
        </span>
      </Button>)}
    </div>
    {selected && <div className="motion-history-detail">
      {!compact && <><div className="motion-history-detail-title">{t("Changes in this version")}</div>
      <ul>{selected.files.map(file => <li key={file.path}><Tooltip label={file.path} wrap><code>{file.path}</code></Tooltip>
        <span>{file.status === 'added' || file.before === null ? t('Created') : file.status === 'deleted' || file.after === null ? t("Deleted") : t("Modified")}</span></li>)}</ul></>}
      <div className="motion-history-detail-actions">
        {allowPinning && <Button variant="plain" type="button" className="motion-button" disabled={disabled} onClick={() => { trackStudioClick('version_history', 'pin_version', projectId, undefined, selected.pinned ? 'off' : 'on'); void pin(selected); }}>{selected.pinned ? t("Unpin version") : t("Keep this version")}</Button>}
        <Button variant="plain" type="button" className="motion-button motion-button-primary" disabled={disabled || (currentSeq == null ? selected.id === entries.at(-1)?.id : selected.seq === currentSeq)}
          onClick={() => { trackStudioClick('version_history', 'restore_version', projectId); void restore(selected); }}>{t("Restore this version")}</Button>
      </div>
      {!compact && <p>{t("Restoring creates a new entry and keeps your current changes in history.")}</p>}
    </div>}
  </section>;
}
