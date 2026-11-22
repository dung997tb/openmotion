import { useEffect, useMemo, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import type {
  SuperAgentArtifact,
  SuperAgentChat,
  SuperAgentFileOperation,
  SuperAgentMessage,
  SuperAgentResourceAttachment,
  SuperAgentToolCategory,
  SuperAgentToolEvent,
} from '../../../shared/super-agent';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { WorkingIndicator } from '../motion/AssetCreationVisuals';
import { resourceIcon, resourceKey } from './ResourcePickerDialog';
import { SimpleMarkdown } from './SimpleMarkdown';

type TurnGroup = {
  id: string;
  user?: SuperAgentMessage;
  workItems: SuperAgentMessage[];
  assistantItems: SuperAgentMessage[];
  changedFiles: SuperAgentFileOperation[];
  artifacts: SuperAgentArtifact[];
  hasRunning: boolean;
  hasFailure: boolean;
  durationMs?: number;
};

export function formatElapsedDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(10, Math.round(ms))}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  return `${mins}m ${remSecs}s`;
}

function categoryIcon(category: SuperAgentToolCategory | undefined, status: SuperAgentToolEvent['status']): string {
  if (status === 'running') return 'loader-4-line';
  if (status === 'failed') return 'error-warning-line';
  switch (category) {
    case 'command':
      return 'terminal-box-fill';
    case 'file_read':
      return 'file-text-line';
    case 'file_write':
      return 'file-add-line';
    case 'file_edit':
      return 'file-code-line';
    case 'file_delete':
      return 'delete-bin-line';
    case 'search':
      return 'search-line';
    case 'web':
      return 'global-line';
    case 'mcp':
      return 'apps-2-line';
    case 'agent':
      return 'robot-fill';
    default:
      return 'code-s-slash-line';
  }
}

function artifactKindIcon(kind: SuperAgentArtifact['kind']): string {
  switch (kind) {
    case 'design-project':
      return 'layout-line';
    case 'motion-project':
      return 'movie-line';
    case 'motion-export':
      return 'clapperboard-line';
    case 'asset-image':
      return 'image-line';
    case 'asset-video':
      return 'film-line';
    case 'asset-audio':
      return 'music-2-line';
    case 'brand-kit':
      return 'palette-line';
    case 'game-project':
      return 'gamepad-line';
    case 'web':
      return 'global-line';
    default:
      return 'file-line';
  }
}

function collectTurnFiles(workItems: SuperAgentMessage[]): SuperAgentFileOperation[] {
  const byPath = new Map<string, SuperAgentFileOperation>();
  for (const item of workItems) {
    if (item.role !== 'tool' || !item.toolEvent) continue;
    const ev = item.toolEvent;
    const candidates = ev.files?.length ? ev.files : ev.fileOp ? [ev.fileOp] : [];
    for (const op of candidates) {
      if (!op.path || op.action === 'read') continue;
      const existing = byPath.get(op.path);
      if (!existing) {
        byPath.set(op.path, { ...op });
      } else {
        byPath.set(op.path, {
          ...existing,
          action: existing.action === 'create' && op.action === 'edit' ? 'create' : op.action,
          addedLines: (existing.addedLines ?? 0) + (op.addedLines ?? 0) || existing.addedLines || op.addedLines,
          removedLines: (existing.removedLines ?? 0) + (op.removedLines ?? 0) || existing.removedLines || op.removedLines,
          diffPreview: op.diffPreview || existing.diffPreview,
        });
      }
    }
  }
  return [...byPath.values()];
}

function groupMessagesIntoTurns(chat: SuperAgentChat): TurnGroup[] {
  const artifactsById = new Map(chat.artifacts.map(a => [a.id, a]));
  const rawTurns: { user?: SuperAgentMessage; rest: SuperAgentMessage[] }[] = [];

  for (const msg of chat.messages) {
    if (msg.role === 'user') {
      rawTurns.push({ user: msg, rest: [] });
    } else {
      if (!rawTurns.length) rawTurns.push({ rest: [] });
      rawTurns[rawTurns.length - 1].rest.push(msg);
    }
  }

  const claimedArtifactIds = new Set<string>();
  return rawTurns.map((group, idx) => {
    const workItems = group.rest.filter(m => m.role === 'reasoning' || m.role === 'tool');
    const assistantItems = group.rest.filter(m => m.role === 'assistant');
    const artifactIds = new Set<string>();
    for (const m of group.rest) {
      if (m.toolEvent?.artifactId) {
        artifactIds.add(m.toolEvent.artifactId);
        claimedArtifactIds.add(m.toolEvent.artifactId);
      }
      if (m.artifactIds) {
        for (const id of m.artifactIds) {
          artifactIds.add(id);
          claimedArtifactIds.add(id);
        }
      }
    }
    const turnStart = group.user?.createdAt ?? group.rest[0]?.createdAt ?? 0;
    const nextTurnStart = rawTurns[idx + 1]?.user?.createdAt ?? rawTurns[idx + 1]?.rest[0]?.createdAt;
    for (const artifact of chat.artifacts) {
      if (claimedArtifactIds.has(artifact.id)) continue;
      const ts = artifact.updatedAt || artifact.createdAt;
      if (ts >= turnStart && (nextTurnStart === undefined || ts < nextTurnStart)) {
        artifactIds.add(artifact.id);
        claimedArtifactIds.add(artifact.id);
      }
    }
    const artifacts = [...artifactIds]
      .map(id => artifactsById.get(id))
      .filter((a): a is SuperAgentArtifact => Boolean(a));
    const changedFiles = collectTurnFiles(workItems);
    const hasRunning = workItems.some(
      m => m.status === 'streaming' || m.toolEvent?.status === 'running',
    );
    const hasFailure = workItems.some(m => m.toolEvent?.status === 'failed');

    let durationMs: number | undefined;
    if (idx === rawTurns.length - 1 && chat.lastTurnDurationMs !== undefined) {
      durationMs = chat.lastTurnDurationMs;
    } else if (group.user && group.rest.length > 0) {
      const last = group.rest[group.rest.length - 1];
      const endTs = last.toolEvent?.finishedAt ?? last.createdAt;
      if (endTs >= group.user.createdAt) {
        durationMs = endTs - group.user.createdAt;
      }
    }

    return {
      id: group.user?.id ?? `turn-${idx}`,
      user: group.user,
      workItems,
      assistantItems,
      changedFiles,
      artifacts,
      hasRunning,
      hasFailure,
      durationMs,
    };
  });
}

function UnifiedDiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split('\n').slice(0, 120), [diff]);
  return (
    <pre className="om-sa-diff-pre">
      {lines.map((line, i) => {
        const kind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
          ? 'meta'
          : line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'ctx';
        return (
          <span key={i} className="om-sa-diff-line" data-kind={kind}>
            {line}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

function ToolStepRow({
  message,
  onOpenArtifactId,
}: {
  message: SuperAgentMessage;
  onOpenArtifactId: (artifactId: string) => void;
}) {
  const { t } = useI18n();
  const ev = message.toolEvent;
  if (!ev) return null;
  const status = ev.status ?? 'completed';
  const fileOp = ev.fileOp ?? ev.files?.[0];
  const diffFiles = (ev.files ?? (fileOp ? [fileOp] : [])).filter(f => f.diffPreview);
  const hasBody = Boolean(ev.command || diffFiles.length > 0 || ev.inputPreview || ev.outputPreview);

  return (
    <details className="om-sa-tool-row" open={status === 'failed' || undefined}>
      <summary>
        <span
          className="om-sa-tool-status"
          data-status={status}
          data-category={ev.category || 'tool'}
        >
          <RemixIcon name={categoryIcon(ev.category, status)} size={15} />
        </span>
        <span className="om-sa-tool-label">{t(ev.label || message.text)}</span>
        {ev.summary && ev.summary !== ev.label && (
          <span className="om-sa-tool-summary" title={ev.summary}>{ev.summary}</span>
        )}
        {fileOp && (fileOp.addedLines !== undefined || fileOp.removedLines !== undefined) && (
          <span className="om-sa-diff-badges">
            {fileOp.addedLines !== undefined && fileOp.addedLines > 0 && (
              <span className="om-sa-diff-add">+{fileOp.addedLines}</span>
            )}
            {fileOp.removedLines !== undefined && fileOp.removedLines > 0 && (
              <span className="om-sa-diff-del">-{fileOp.removedLines}</span>
            )}
          </span>
        )}
        {ev.exitCode !== undefined && (
          <span className="om-sa-exit-pill" data-ok={ev.exitCode === 0 || undefined}>
            {ev.exitCode === 0 ? 'exit 0' : `exit ${ev.exitCode}`}
          </span>
        )}
        {ev.durationMs !== undefined && status !== 'running' && (
          <span className="om-sa-step-time">{formatElapsedDuration(ev.durationMs)}</span>
        )}
        {ev.artifactId && (
          <Button
            variant="plain"
            type="button"
            className="om-sa-tool-view-btn"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onOpenArtifactId(ev.artifactId!);
            }}
          >
            <span>{t('View in Viewer')}</span>
            <RemixIcon name="arrow-right-up-line" size={13} />
          </Button>
        )}
        {hasBody && <RemixIcon name="arrow-down-s-line" size={14} />}
      </summary>
      {hasBody && (
        <div className="om-sa-tool-body">
          {ev.command && (
            <div className="om-sa-cmd-block">
              <span className="om-sa-cmd-prompt" aria-hidden="true">$</span>
              <code>{ev.command}</code>
            </div>
          )}
          {diffFiles.map((file, idx) => (
            <div key={`${file.path}-${idx}`} className="om-sa-diff-card">
              <div className="om-sa-diff-head">
                <span className="om-sa-diff-path">{file.path}</span>
                <span className="om-sa-diff-badges">
                  {file.addedLines !== undefined && <span className="om-sa-diff-add">+{file.addedLines}</span>}
                  {file.removedLines !== undefined && <span className="om-sa-diff-del">-{file.removedLines}</span>}
                </span>
              </div>
              {file.diffPreview && <UnifiedDiffView diff={file.diffPreview} />}
            </div>
          ))}
          {ev.inputPreview && ev.category !== 'command' && diffFiles.length === 0 && (
            <>
              <span className="om-eyebrow">{t('Input')}</span>
              <pre className="om-code-block">{ev.inputPreview}</pre>
            </>
          )}
          {ev.outputPreview && (
            <>
              <span className="om-eyebrow">{t('Output')}</span>
              <pre className="om-code-block">{ev.outputPreview}</pre>
            </>
          )}
        </div>
      )}
    </details>
  );
}

function ReasoningStepRow({ message }: { message: SuperAgentMessage }) {
  const { t } = useI18n();
  const isStreaming = message.status === 'streaming';
  const durationLabel = !isStreaming && message.durationMs !== undefined
    ? t('Thought for {duration}', { duration: formatElapsedDuration(message.durationMs) })
    : isStreaming
      ? t('Thinking…')
      : t('Reasoning');

  return (
    <details className="om-sa-reasoning-row" open={isStreaming || undefined}>
      <summary>
        <span className="om-sa-reasoning-icon" data-streaming={isStreaming || undefined}>
          <RemixIcon name={isStreaming ? 'loader-4-line' : 'sparkling-line'} size={14} />
        </span>
        <span className="om-sa-reasoning-label">{durationLabel}</span>
        {!isStreaming && message.text && (
          <span className="om-sa-tool-summary">{message.text.slice(0, 120)}</span>
        )}
        <RemixIcon name="arrow-down-s-line" size={14} />
      </summary>
      {message.text && (
        <div className="om-sa-reasoning-body">{message.text}</div>
      )}
    </details>
  );
}

function FilesChangedCard({
  files,
  onCopyText,
}: {
  files: SuperAgentFileOperation[];
  onCopyText: (text: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!files.length) return null;

  const totalAdd = files.reduce((sum, f) => sum + (f.addedLines ?? 0), 0);
  const totalDel = files.reduce((sum, f) => sum + (f.removedLines ?? 0), 0);

  return (
    <div className="om-sa-files-changed">
      <Button
        variant="plain"
        type="button"
        className="om-sa-files-changed-head"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
      >
        <RemixIcon name="file-code-line" size={14} />
        <span className="om-sa-files-changed-title">
          {t('Files changed ({count})', { count: files.length })}
        </span>
        {(totalAdd > 0 || totalDel > 0) && (
          <span className="om-sa-diff-badges">
            {totalAdd > 0 && <span className="om-sa-diff-add">+{totalAdd}</span>}
            {totalDel > 0 && <span className="om-sa-diff-del">-{totalDel}</span>}
          </span>
        )}
        <span className="om-sa-files-changed-chevron" data-open={expanded || undefined}>
          <RemixIcon name="arrow-down-s-line" size={14} />
        </span>
      </Button>
      {expanded && (
        <div className="om-sa-files-changed-list">
          {files.map(file => (
            <div key={file.path} className="om-sa-file-change-item">
              <div className="om-sa-file-change-row">
                <span className="om-sa-file-action-badge" data-action={file.action}>
                  {file.action === 'create' ? 'A' : file.action === 'delete' ? 'D' : 'M'}
                </span>
                <Button
                  variant="plain"
                  type="button"
                  className="om-sa-file-path-btn"
                  title={t('Copy path')}
                  onClick={() => onCopyText(file.path)}
                >
                  {file.path}
                </Button>
                <span className="om-sa-diff-badges">
                  {file.addedLines !== undefined && file.addedLines > 0 && (
                    <span className="om-sa-diff-add">+{file.addedLines}</span>
                  )}
                  {file.removedLines !== undefined && file.removedLines > 0 && (
                    <span className="om-sa-diff-del">-{file.removedLines}</span>
                  )}
                </span>
              </div>
              {file.diffPreview && <UnifiedDiffView diff={file.diffPreview} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkLogSection({
  turn,
  isActiveTurn,
  onOpenArtifactId,
  onCopyText,
}: {
  turn: TurnGroup;
  isActiveTurn: boolean;
  onOpenArtifactId: (artifactId: string) => void;
  onCopyText: (text: string) => void;
}) {
  const { t } = useI18n();
  const shouldAutoExpand = isActiveTurn || turn.hasRunning || turn.hasFailure || turn.assistantItems.length === 0;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = userToggled ?? shouldAutoExpand;

  if (!turn.workItems.length) return null;

  const toolCount = turn.workItems.filter(m => m.role === 'tool').length;
  const stepCount = turn.workItems.length;
  const durationStr = formatElapsedDuration(turn.durationMs);
  const summaryTitle = isActiveTurn || turn.hasRunning
    ? t('Running steps ({count})', { count: stepCount })
    : durationStr
      ? t('Worked for {duration} · {count} steps', { duration: durationStr, count: stepCount })
      : toolCount > 0
        ? t('Execution steps ({count})', { count: stepCount })
        : t('Thought');

  return (
    <div className="om-sa-work-log" data-active={isActiveTurn || undefined}>
      <Button
        variant="plain"
        type="button"
        className="om-sa-work-summary-btn"
        aria-expanded={expanded}
        onClick={() => setUserToggled(prev => !(prev ?? shouldAutoExpand))}
      >
        <span className="om-sa-work-chevron" data-open={expanded || undefined}>
          <RemixIcon name="arrow-down-s-line" size={14} />
        </span>
        <span className="om-sa-work-summary-label">{summaryTitle}</span>
        {turn.changedFiles.length > 0 && (
          <span className="om-sa-work-pill">
            {t('{count} files', { count: turn.changedFiles.length })}
          </span>
        )}
        {turn.hasFailure && (
          <span className="om-sa-work-pill" data-tone="danger">
            {t('Needs attention')}
          </span>
        )}
      </Button>
      {expanded && (
        <div className="om-sa-work-items">
          {turn.workItems.map(item =>
            item.role === 'reasoning' ? (
              <ReasoningStepRow key={item.id} message={item} />
            ) : (
              <ToolStepRow
                key={item.id}
                message={item}
                onOpenArtifactId={onOpenArtifactId}
              />
            ),
          )}
        </div>
      )}
      {!isActiveTurn && turn.changedFiles.length > 0 && (
        <FilesChangedCard files={turn.changedFiles} onCopyText={onCopyText} />
      )}
    </div>
  );
}

function LiveTurnStatusBar({
  chat,
  engineLabel,
}: {
  chat: SuperAgentChat;
  engineLabel?: string;
}) {
  const { t } = useI18n();
  const startedAt = chat.turnActivity?.startedAt || chat.updatedAt;
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const timer = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 200);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const phase = chat.turnActivity?.phase ?? 'thinking';
  const targetLabel = chat.turnActivity?.label || engineLabel || 'Super Agent';
  const statusText =
    phase === 'connecting'
      ? t('Connecting to {agent}…', { agent: targetLabel })
      : phase === 'tool'
        ? t(chat.turnActivity?.label || 'Running {tool}…', { tool: chat.turnActivity?.activeToolName || 'tool' })
        : phase === 'streaming'
          ? t('Writing response…')
          : phase === 'waiting_approval'
            ? t('Waiting for approval…')
            : t('Thinking…');

  return (
    <div className="om-sa-live-status-wrap">
      <div className="om-creation-thinking om-sa-thinking om-sa-live-status" role="status">
        <WorkingIndicator />
        <span className="om-sa-live-status-label">{statusText}</span>
        <span className="om-sa-live-timer">{formatElapsedDuration(elapsedMs)}</span>
      </div>
      {chat.turnActivity?.plan && chat.turnActivity.plan.length > 0 && (
        <div className="om-sa-plan-card">
          <div className="om-sa-plan-head">{t('Plan')}</div>
          <ul className="om-sa-plan-list">
            {chat.turnActivity.plan.map((entry, idx) => (
              <li key={idx} className="om-sa-plan-item" data-status={entry.status}>
                <RemixIcon
                  name={
                    entry.status === 'completed'
                      ? 'checkbox-circle-line'
                      : entry.status === 'in_progress'
                        ? 'loader-4-line'
                        : 'checkbox-blank-line'
                  }
                  size={14}
                />
                <span>{entry.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ExecutionTimeline({
  chat,
  busy,
  sending,
  engineLabel,
  onOpenArtifactId,
  onPreviewAttachment,
  onOpenWebUrl,
  onCopyText,
  onApprove,
}: {
  chat: SuperAgentChat;
  busy: boolean;
  sending: boolean;
  engineLabel?: string;
  onOpenArtifactId: (artifactId: string) => void;
  onPreviewAttachment: (attachment: SuperAgentResourceAttachment) => void;
  onOpenWebUrl?: (url: string) => void;
  onCopyText: (text: string) => void;
  onApprove: (approvalId: string, accepted: boolean) => void;
}) {
  const { t } = useI18n();
  const turns = useMemo(() => groupMessagesIntoTurns(chat), [chat]);

  return (
    <div className="om-sa-message-list">
      {turns.map((turn, idx) => {
        const isLastTurn = idx === turns.length - 1;
        const isActiveTurn = busy && isLastTurn;
        const combinedAssistantText = turn.assistantItems.map(m => m.text).filter(Boolean).join('\n\n');

        return (
          <div key={turn.id} className="om-sa-turn" data-active={isActiveTurn || undefined}>
            {turn.user && (
              <article className="om-sa-message" data-role="user">
                <div className="om-sa-message-body">
                  {turn.user.attachments && turn.user.attachments.length > 0 && (
                    <div className="om-sa-msg-attachments">
                      {turn.user.attachments.map(att => (
                        <Button
                          key={resourceKey(att)}
                          variant="plain"
                          type="button"
                          className="om-sa-attachment-chip"
                          onClick={() => onPreviewAttachment(att)}
                        >
                          <RemixIcon name={resourceIcon(att)} size={13} />
                          <span>{att.title}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="om-sa-user-bubble">{turn.user.text}</div>
                </div>
              </article>
            )}

            <WorkLogSection
              turn={turn}
              isActiveTurn={isActiveTurn}
              onOpenArtifactId={onOpenArtifactId}
              onCopyText={onCopyText}
            />

            {turn.assistantItems.map(msg => (
              <article key={msg.id} className="om-sa-message" data-role="assistant">
                <span className="om-creation-icon om-sa-avatar" data-tone="agent" aria-hidden="true">
                  <RemixIcon name="sparkling-fill" size={16} />
                </span>
                <div className="om-sa-message-body">
                  <div className="om-sa-assistant-content">
                    <SimpleMarkdown
                      content={msg.text}
                      onCopyCode={onCopyText}
                      onOpenWebUrl={onOpenWebUrl}
                    />
                  </div>
                </div>
              </article>
            ))}

            {turn.artifacts.length > 0 && (
              <div className="om-sa-deliverables">
                {turn.artifacts.map(artifact => (
                  <Button
                    key={artifact.id}
                    variant="plain"
                    type="button"
                    className="om-sa-deliverable-card"
                    onClick={() => onOpenArtifactId(artifact.id)}
                  >
                    <span className="om-sa-deliverable-icon" aria-hidden="true">
                      <RemixIcon name={artifactKindIcon(artifact.kind)} size={15} />
                    </span>
                    <span className="om-sa-deliverable-meta">
                      <strong>{artifact.title}</strong>
                      {artifact.subtitle && <small>{artifact.subtitle}</small>}
                    </span>
                    <RemixIcon name="arrow-right-up-line" size={14} />
                  </Button>
                ))}
              </div>
            )}

            {!isActiveTurn && turn.assistantItems.length > 0 && (
              <div className="om-sa-turn-footer">
                <span className="om-sa-turn-meta">
                  {engineLabel || chat.engine}
                  {turn.durationMs !== undefined ? ` · ${formatElapsedDuration(turn.durationMs)}` : ''}
                  {isLastTurn && chat.lastTurnUsage?.totalTokens
                    ? ` · ${chat.lastTurnUsage.totalTokens.toLocaleString()} ${t('tokens')}`
                    : ''}
                </span>
                {combinedAssistantText && (
                  <IconButton
                    variant="ghost"
                    className="motion-icon-button"
                    aria-label={t('Copy response')}
                    title={t('Copy response')}
                    onClick={() => onCopyText(combinedAssistantText)}
                    icon={<RemixIcon name="file-copy-line" size={13} />}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {busy && !chat.approvals.length && (
        <LiveTurnStatusBar chat={chat} engineLabel={engineLabel} />
      )}

      {chat.error && (
        <div className="om-card om-sa-error-card" role="alert">
          <RemixIcon name="error-warning-line" size={18} />
          <div>
            <strong>{t('Conversation paused')}</strong>
            <p className="om-muted">{chat.error}</p>
          </div>
        </div>
      )}

      {chat.approvals.map(approval => (
        <section key={approval.id} className="om-creation-approval om-sa-approval">
          <div className="om-creation-row">
            <span className="om-creation-icon" data-tone="audio">
              <RemixIcon name="shield-check-line" size={18} />
            </span>
            <div>
              <h3 className="om-subtitle">{t(approval.title)}</h3>
              <p className="om-muted">{t('Review this action before it runs.')}</p>
            </div>
          </div>
          <pre className="om-code-block">{approval.detail}</pre>
          <div className="om-asset-actions">
            <Button
              variant="ghost"
              className="om-button h-auto"
              disabled={sending}
              onClick={() => onApprove(approval.id, false)}
            >
              {t('Decline')}
            </Button>
            <Button
              variant="ghost"
              className="om-button h-auto"
              data-primary
              disabled={sending}
              onClick={() => onApprove(approval.id, true)}
            >
              <RemixIcon name="check-line" size={15} />
              <span>{t('Approve')}</span>
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}
