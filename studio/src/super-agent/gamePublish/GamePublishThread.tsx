import { Button } from 'open-design-ui/button';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { gamePublishActions, useGamePublishThread, type GamePublishThreadEntry } from './gamePublishStore';
import { gamePublishPlatform } from './platforms';
import './gamePublish.css';

/**
 * Publish activity in the conversation: the user's actions, Agent progress, "Your turn" cards
 * and result cards. Reads the same store as the right-hand publish panel, so the user can finish
 * a step from either place. Local only — these entries are not sent to the Agent (no model call).
 */
export function GamePublishThread({ chatId, onOpenPanel, onNotify }: {
  chatId: string | null | undefined;
  onOpenPanel: (artifactId: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
}) {
  const { t } = useI18n();
  const entries = useGamePublishThread(chatId);
  const endRef = useRef<HTMLDivElement>(null);
  const lastEntry = entries.at(-1);
  const progressKey = lastEntry ? `${lastEntry.id}:${lastEntry.kind === 'agent' ? lastEntry.lines.length : 0}` : '';
  // Keep the newest publish activity in view, like new Agent messages.
  useEffect(() => {
    if (progressKey) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [progressKey]);
  if (!entries.length) return null;
  return (
    <div className="om-gp-thread" aria-label={t('Publish activity')}>
      {entries.map(entry => <ThreadEntry key={entry.id} entry={entry} onOpenPanel={onOpenPanel} onNotify={onNotify} />)}
      <div ref={endRef} />
    </div>
  );
}

function ThreadEntry({ entry, onOpenPanel, onNotify }: {
  entry: GamePublishThreadEntry;
  onOpenPanel: (artifactId: string) => void;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
}) {
  const { t } = useI18n();
  if (entry.kind === 'user') {
    return <div className="om-gp-user">{t(entry.key, entry.name ? { name: t(entry.name) } : undefined)}</div>;
  }
  if (entry.kind === 'agent') {
    return (
      <div className="om-gp-agent">
        <div className="om-gp-agent-title">{t(entry.title, entry.name ? { name: t(entry.name) } : undefined)}</div>
        {entry.lines.map((line, index) => (
          <div key={index} className="om-gp-line" data-done={line.done || undefined}>
            <RemixIcon name={line.done ? 'check-line' : 'loader-4-line'} size={13} className={line.done ? undefined : 'om-gp-spin'} />
            <span>{t(line.text)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (entry.kind === 'need') {
    const platform = gamePublishPlatform(entry.platformId);
    const step = platform?.steps[entry.stepIndex];
    if (!platform || !step) return null;
    const needsChoice = Boolean(step.pick);
    return (
      <div className="om-gp-card" data-closed={entry.closed || undefined}>
        <div className="om-gp-card-eyebrow">
          {entry.closed
            ? t('Done · {name} step {current} of {total}', { name: t(platform.name), current: entry.stepIndex + 1, total: platform.steps.length })
            : t('Your turn · {name} step {current} of {total}', { name: t(platform.name), current: entry.stepIndex + 1, total: platform.steps.length })}
        </div>
        <p>{t(step.why)}</p>
        <ol>{step.todo.map(item => <li key={item}>{t(item)}</li>)}</ol>
        {!entry.closed && (
          <div className="om-gp-card-actions">
            {needsChoice ? (
              <Button variant="plain" type="button" className="om-gp-primary" onClick={() => onOpenPanel(entry.artifactId)}>{t('Choose in the panel')}</Button>
            ) : (
              <>
                <Button variant="plain" type="button" className="om-gp-primary" onClick={() => void gamePublishActions.completeStep(entry.artifactId)}>{t(step.cta)}</Button>
                <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => onOpenPanel(entry.artifactId)}>{t('Open in the panel')}</Button>
                <span className="om-gp-muted">{t('Tell me when it is done')}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="om-gp-result-card">
      <RemixIcon name="checkbox-circle-fill" size={22} className="om-gp-result-icon" />
      <strong>{t(entry.title)}</strong>
      <span className="om-gp-muted">{entry.link ? entry.detail : t(entry.detail)}</span>
      <Button variant="plain" type="button" className="om-gp-primary" onClick={() => { if (entry.link) onNotify?.(t('Link copied')); }}>{t(entry.action)}</Button>
    </div>
  );
}
