import { Button } from 'open-design-ui/button';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { copyGamePublishLink, gamePublishActions, useGamePublishSession, type GamePublishSession } from './gamePublishStore';
import { GamePublishResultAction } from './GamePublishThread';
import { MOCK_PLAYABLE_SIZE_MB, playableNetwork } from './playableNetworks';
import { GAME_PUBLISH_PLATFORMS, UNSUPPORTED_PLATFORMS_NOTE, gamePublishPlatform, type GamePublishPlatform } from './platforms';
import './gamePublish.css';

/**
 * Right-hand publish panel, docked inside the Artifact viewer next to the game preview.
 * Fixed position and height; Agent progress scrolls in the conversation, the panel only keeps
 * one status line. Platform calls are mocks (see gamePublishAdapter.ts).
 */
export function GamePublishPanel({ artifactId, coverUrl, onNotify }: {
  artifactId: string;
  coverUrl?: string;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
}) {
  const { t } = useI18n();
  const session = useGamePublishSession(artifactId);
  if (!session?.open) return null;
  const platform = gamePublishPlatform(session.platformId);
  const close = () => gamePublishActions.close(artifactId);

  const statusLine = (
    <div className="om-gp-status" data-tone={session.status.tone} role="status">
      <span className="om-gp-status-dot" aria-hidden="true" />
      <span className="om-gp-status-text">{t(session.status.key, session.status.line ? { line: t(session.status.line) } : undefined)}</span>
      {session.chatId && <span className="om-gp-status-hint">{t('Details in the conversation')}</span>}
    </div>
  );

  const header = (title: string, back?: { label: string; onClick: () => void }) => (
    <header className="om-gp-head">
      {back && (
        <Button variant="plain" type="button" className="om-gp-back" onClick={back.onClick}>
          <RemixIcon name="arrow-left-s-line" size={15} />
          <span>{back.label}</span>
        </Button>
      )}
      <h2 className="om-gp-title">{title}</h2>
      <span className="om-gp-mock" title={t('Platform connections are not live yet; steps and results are sample data.')}>{t('Mock')}</span>
      <Button variant="plain" type="button" className="om-gp-close" aria-label={t('Close')} onClick={close}>
        <RemixIcon name="close-line" size={16} />
      </Button>
    </header>
  );

  const tiles = (list: readonly GamePublishPlatform[]) => (
    <div className="om-gp-tiles">
      {list.map(item => {
        const done = session.published.includes(item.id);
        return (
          <Button key={item.id} variant="plain" type="button" className="om-gp-tile" onClick={() => gamePublishActions.choose(artifactId, item.id)}>
            <span className="om-gp-badge" style={{ background: item.color, color: '#fff' /* third-party brand badge */ }} aria-hidden="true">{item.badge}</span>
            <span className="om-gp-tile-text">
              <strong>{t(item.name)}</strong>
              <small data-done={done || undefined}>{done ? t('Published') : t(item.effort)}</small>
            </span>
            <RemixIcon name="arrow-right-s-line" size={15} className="om-gp-tile-caret" />
          </Button>
        );
      })}
    </div>
  );

  const groups = (['China', 'Global', 'Ads'] as const).map(group => ({ group, list: GAME_PUBLISH_PLATFORMS.filter(item => item.group === group) }));
  const groupLabel = { China: 'China', Global: 'Global', Ads: 'Export package (no account needed)' } as const;
  const unsupported = <p className="om-gp-note">{t(UNSUPPORTED_PLATFORMS_NOTE)}</p>;

  let body: ReactNode;
  let foot: ReactNode;
  let head: ReactNode;
  let showStatus = true;

  if (session.view === 'home') {
    showStatus = false;
    head = header(t('Publish'));
    body = (
      <>
        <div className="om-gp-hero">
          {coverUrl ? <img src={coverUrl} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className="om-gp-hero-placeholder"><RemixIcon name="gamepad-line" size={22} /></span>}
          <div>
            <strong>{session.gameTitle}</strong>
            <span className="om-gp-prefilled">{t('Filled in for you')}</span>
            <p>{t('Cover, title and description come from the game. You can change them later.')}</p>
          </div>
        </div>
        <h3 className="om-gp-h3">{t('Start with a game link')}</h3>
        <p className="om-gp-muted">{t('Anyone can play it. Then use the link to publish to WeChat, Xiaohongshu, itch.io and more, one at a time.')}</p>
      </>
    );
    foot = (
      <>
        <Button variant="plain" type="button" className="om-gp-text-btn" onClick={() => gamePublishActions.showList(artifactId)}>
          {t('Publish to another platform')}
        </Button>
        <span className="om-gp-spacer" />
        <Button variant="plain" type="button" className="om-gp-primary" disabled={session.linkPublishing} onClick={() => void gamePublishActions.publishLink(artifactId)}>
          {session.linkPublishing ? t('Publishing…') : t('Publish link')}
        </Button>
      </>
    );
    if (session.linkPublishing) showStatus = true;
  } else if (session.view === 'link-result') {
    head = header(t('Publish'));
    body = (
      <>
        <div className="om-gp-result">
          <RemixIcon name="checkbox-circle-fill" size={30} className="om-gp-result-icon" />
          <strong>{t('Live')}</strong>
          <span className="om-gp-muted">{session.linkUrl}</span>
          <Button variant="plain" type="button" className="om-gp-primary" onClick={() => void copyGamePublishLink(session.linkUrl, onNotify, t)}>{t('Copy link')}</Button>
        </div>
        <h3 className="om-gp-h3">{t('Also publish to (one at a time)')}</h3>
        {tiles(GAME_PUBLISH_PLATFORMS)}
        {unsupported}
      </>
    );
    showStatus = false;
    foot = <><span className="om-gp-spacer" /><Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Close')}</Button></>;
  } else if (session.view === 'list') {
    head = header(t('Choose a platform'), { label: t('Game link'), onClick: () => gamePublishActions.showHome(artifactId) });
    body = (
      <>
        <p className="om-gp-muted">{t('Pick one to start. Steps only you can do are shown one at a time; the Agent does the rest.')}</p>
        {groups.map(({ group, list }) => (
          <section key={group}>
            <h3 className="om-gp-group">{t(groupLabel[group])}</h3>
            {tiles(list)}
          </section>
        ))}
        {unsupported}
      </>
    );
    showStatus = false;
  } else if (platform) {
    head = header(t(platform.name), session.view === 'step' ? { label: t('Platforms'), onClick: () => gamePublishActions.showList(artifactId) } : undefined);
    const bar = <StepBar session={session} platform={platform} />;
    if (session.view === 'step') {
      const step = platform.steps[session.stepIndex];
      body = (
        <>
          {bar}
          <h3 className="om-gp-h3">{t(step.title)}</h3>
          <p className="om-gp-muted">{t(step.why)}</p>
          {step.fields?.map(field => (
            <label key={field.label} className="om-gp-field">
              <span className="om-gp-field-label">
                {t(field.label)}
                {field.prefilled && <span className="om-gp-prefilled">{t('Filled in for you')}</span>}
                {field.link && <a href={field.link.href} target="_blank" rel="noopener noreferrer">{t(field.link.label)} <RemixIcon name="external-link-line" size={12} /></a>}
              </span>
              <input
                className="om-gp-input"
                value={field.prefilled ?? session.inputs[field.label] ?? ''}
                readOnly={Boolean(field.prefilled)}
                placeholder={field.placeholder ? t(field.placeholder) : undefined}
                onChange={event => gamePublishActions.setInput(artifactId, field.label, event.target.value)}
              />
            </label>
          ))}
          {step.pick && (
            <>
              <div className="om-gp-chips" role="radiogroup" aria-label={t(step.title)}>
                {step.pick.map(option => (
                  <Button key={option} variant="plain" type="button" role="radio" aria-checked={session.picked === option} className="om-gp-chip" data-selected={session.picked === option || undefined} onClick={() => gamePublishActions.pick(artifactId, option)}>
                    {option}
                  </Button>
                ))}
              </div>
              {!session.picked && <p className="om-gp-need">{t('Networks have different rules, so you choose.')}</p>}
            </>
          )}
          {step.kind === 'checks' && <PlayableChecks networkName={session.picked} />}
          {step.kind === 'download' && <PlayableDownload networkName={session.picked} onNotify={onNotify} />}
          {(step.qr || step.links) && (
            <div className="om-gp-actions-row">
              {step.qr && <span className="om-gp-qr" role="img" aria-label={t('QR code (sample)')} />}
              <div className="om-gp-links">
                {step.links?.map(link => (
                  <a key={link.label} className="om-gp-secondary" href={link.href} target="_blank" rel="noopener noreferrer">{t(link.label)}</a>
                ))}
                {step.qr && <small className="om-gp-muted">{t('QR code (sample)')}</small>}
              </div>
            </div>
          )}
        </>
      );
      foot = (
        <>
          <Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Hide for now')}</Button>
          <span className="om-gp-spacer" />
          <Button variant="plain" type="button" className="om-gp-primary" disabled={Boolean(step.pick && !session.picked)} onClick={() => void gamePublishActions.completeStep(artifactId)}>
            {t(step.cta)}
          </Button>
        </>
      );
    } else if (session.view === 'working') {
      const step = platform.steps[Math.min(session.stepIndex, platform.steps.length - 1)];
      body = (
        <>
          {bar}
          <div className="om-gp-wait">
            <RemixIcon name="loader-4-line" size={28} className="om-gp-spin" />
            <strong>{t(step.working)}</strong>
            <span className="om-gp-muted">{t('You can hide this panel. Progress stays in the conversation.')}</span>
          </div>
        </>
      );
      foot = <><Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Hide panel')}</Button><span className="om-gp-spacer" /></>;
    } else {
      body = (
        <>
          {bar}
          <div className="om-gp-result">
            <RemixIcon name="checkbox-circle-fill" size={30} className="om-gp-result-icon" />
            <strong>{t(platform.resultTitle)}</strong>
            <span className="om-gp-muted">{t(platform.resultDetail)}</span>
            <GamePublishResultAction action={platform.resultAction} href={platform.resultHref} onNotify={onNotify} />
          </div>
        </>
      );
      foot = (
        <>
          <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => gamePublishActions.showList(artifactId)}>{t('Publish to another platform')}</Button>
          <span className="om-gp-spacer" />
          <Button variant="plain" type="button" className="om-gp-secondary" onClick={close}>{t('Close')}</Button>
        </>
      );
    }
  }

  return (
    <aside className="om-gp-panel" aria-label={t('Publish panel')}>
      {head}
      <div className="om-gp-body">{body}</div>
      {showStatus && statusLine}
      {foot && <footer className="om-gp-foot">{foot}</footer>}
    </aside>
  );
}

function StepBar({ session, platform }: { session: GamePublishSession; platform: GamePublishPlatform }) {
  const { t } = useI18n();
  const names = [...platform.steps.map(step => step.short), 'Done'];
  return (
    <ol className="om-gp-steps" aria-label={t('Steps')}>
      {names.map((name, index) => {
        const state = index < session.stepIndex ? 'done' : index === session.stepIndex ? 'current' : 'todo';
        return (
          <li key={name} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="om-gp-step-num">{state === 'done' ? <RemixIcon name="check-line" size={11} /> : index + 1}</span>
            {t(name)}
          </li>
        );
      })}
    </ol>
  );
}

/** Check results for the chosen playable-ad network. Mock values; see playableNetworks.ts. */
function PlayableChecks({ networkName }: { networkName?: string }) {
  const { t } = useI18n();
  const network = playableNetwork(networkName);
  if (!network) return null;
  const sizeOk = MOCK_PLAYABLE_SIZE_MB <= network.limitMb;
  const rows: Array<{ label: string; value: string; tone: 'ok' | 'warn' }> = [
    { label: t('Package'), value: t(network.format), tone: 'ok' },
    { label: t('Package size'), value: t('{size} MB of {limit} MB', { size: MOCK_PLAYABLE_SIZE_MB, limit: network.limitMb }), tone: sizeOk ? 'ok' : 'warn' },
    { label: t('External resources'), value: t('Inlined, no network requests'), tone: 'ok' },
    { label: t('Store button'), value: `window.open → ${network.cta}`, tone: 'ok' },
    { label: 'mraid.js', value: t(network.mraid), tone: 'ok' },
    ...(network.extra ? [{ label: t('Extra assets'), value: t('{asset} (upload it in the ad console)', { asset: t(network.extra) }), tone: 'warn' as const }] : []),
  ];
  return (
    <div className="om-gp-checks">
      <div className="om-gp-checks-head">
        <strong>{network.name}</strong>
        <span className="om-gp-mock">{t('Mock results')}</span>
      </div>
      {rows.map(row => (
        <div key={row.label} className="om-gp-check" data-tone={row.tone}>
          <RemixIcon name={row.tone === 'ok' ? 'checkbox-circle-fill' : 'error-warning-line'} size={14} />
          <span className="om-gp-check-label">{row.label}</span>
          <span className="om-gp-check-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Download the package, then upload it in the network's own console. */
function PlayableDownload({ networkName, onNotify }: { networkName?: string; onNotify?: (message: string, tone?: 'info' | 'error') => void }) {
  const { t } = useI18n();
  const network = playableNetwork(networkName);
  if (!network) return null;
  return (
    <div className="om-gp-download">
      <Button variant="plain" type="button" className="om-gp-secondary" onClick={() => onNotify?.(t('Download is not connected yet in this preview (mock).'))}>
        <RemixIcon name="download-2-line" size={14} />
        <span>{t('Download {file}', { file: network.format.startsWith('Zip') ? 'playable.zip' : 'index.html' })}</span>
      </Button>
      <p className="om-gp-muted">
        {t('Upload it in {console} and preview it there before the ad goes live.', { console: t(network.console.label) })}
      </p>
      {network.console.href && (
        <a className="om-gp-link" href={network.console.href} target="_blank" rel="noopener noreferrer">
          {t('Open {console}', { console: t(network.console.label) })} <RemixIcon name="external-link-line" size={12} />
        </a>
      )}
    </div>
  );
}
