/**
 * One shared publish state per game. The right-hand publish panel and the cards in the
 * conversation both read and change this store, so acting in either place updates both.
 * State lives in memory for the session (front-end prototype); persisting it is a backend task.
 */
import { useSyncExternalStore } from 'react';
import { completeUserStep, prepareForPlatform, publishGameLink } from './gamePublishAdapter';
import { LINK_PUBLISH_STEPS, gamePublishPlatform, type GamePublishPlatformId } from './platforms';

export type GamePublishView = 'home' | 'list' | 'step' | 'working' | 'result' | 'link-result';

export interface GamePublishStatus {
  tone: 'idle' | 'running' | 'done';
  /** English source key; `line` is an English source key substituted as {line}. */
  key: string;
  line?: string;
}

export interface GamePublishSession {
  artifactId: string;
  chatId: string | null;
  gameId: string;
  gameTitle: string;
  open: boolean;
  view: GamePublishView;
  platformId?: GamePublishPlatformId;
  stepIndex: number;
  picked?: string;
  inputs: Record<string, string>;
  preparing: boolean;
  status: GamePublishStatus;
  linkUrl?: string;
  linkPublishing: boolean;
  published: GamePublishPlatformId[];
}

export type GamePublishThreadEntry =
  | { id: string; artifactId: string; kind: 'user'; key: string; name?: string }
  | { id: string; artifactId: string; kind: 'agent'; title: string; name?: string; lines: Array<{ text: string; done: boolean }> }
  | { id: string; artifactId: string; kind: 'need'; platformId: GamePublishPlatformId; stepIndex: number; closed: boolean }
  | { id: string; artifactId: string; kind: 'result'; title: string; detail: string; action?: string; href?: string; link?: boolean };

const sessions = new Map<string, GamePublishSession>();
const threads = new Map<string, GamePublishThreadEntry[]>();
const listeners = new Set<() => void>();
/** Bumped whenever the user picks a platform, so work started for an earlier choice cannot touch the current one. */
const platformRuns = new Map<string, number>();
let entrySeq = 0;

function emit() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function update(artifactId: string, patch: Partial<GamePublishSession>) {
  const current = sessions.get(artifactId);
  if (!current) return;
  sessions.set(artifactId, { ...current, ...patch });
  emit();
}

function threadKey(session: GamePublishSession) { return session.chatId ?? `artifact:${session.artifactId}`; }

type NewThreadEntry = GamePublishThreadEntry extends infer E ? E extends GamePublishThreadEntry ? Omit<E, 'id' | 'artifactId'> : never : never;

function pushEntry(session: GamePublishSession, entry: NewThreadEntry): string {
  const key = threadKey(session);
  const id = `publish-${++entrySeq}`;
  threads.set(key, [...(threads.get(key) ?? []), { ...entry, id, artifactId: session.artifactId } as GamePublishThreadEntry]);
  emit();
  return id;
}

function patchEntry(session: GamePublishSession, id: string, patch: (entry: GamePublishThreadEntry) => GamePublishThreadEntry) {
  const key = threadKey(session);
  threads.set(key, (threads.get(key) ?? []).map(entry => (entry.id === id ? patch(entry) : entry)));
  emit();
}

/** Plays Agent work: one conversation block with ticking lines, and the panel's single status line. */
async function runAgent(artifactId: string, title: string, name: string | undefined, run: (onLine: (line: string) => void) => Promise<unknown>, isCurrent: () => boolean = () => true) {
  const session = sessions.get(artifactId);
  if (!session) return;
  const entryId = pushEntry(session, { kind: 'agent', title, name, lines: [] });
  await run(line => {
    const latest = sessions.get(artifactId);
    if (!latest) return;
    patchEntry(latest, entryId, entry => entry.kind === 'agent'
      ? { ...entry, lines: [...entry.lines.map(item => ({ ...item, done: true })), { text: line, done: false }] }
      : entry);
    if (isCurrent()) update(artifactId, { status: { tone: 'running', key: 'Agent: {line}', line } });
  });
  const latest = sessions.get(artifactId);
  if (!latest) return;
  patchEntry(latest, entryId, entry => entry.kind === 'agent' ? { ...entry, lines: entry.lines.map(item => ({ ...item, done: true })) } : entry);
}

function closeOpenNeedCards(session: GamePublishSession) {
  const key = threadKey(session);
  threads.set(key, (threads.get(key) ?? []).map(entry => (entry.kind === 'need' && entry.artifactId === session.artifactId ? { ...entry, closed: true } : entry)));
}

function stepInProgress(session: GamePublishSession): boolean {
  const platform = gamePublishPlatform(session.platformId);
  return Boolean(platform && session.stepIndex < platform.steps.length);
}

/** A conversation card only acts on the platform and step it was created for. */
export interface GamePublishStepRef { platformId: GamePublishPlatformId; stepIndex: number }
function matchesStep(session: GamePublishSession, ref: GamePublishStepRef) {
  return session.platformId === ref.platformId && session.stepIndex === ref.stepIndex && stepInProgress(session);
}

export const gamePublishActions = {
  open(input: { artifactId: string; chatId: string | null; gameId: string; gameTitle: string }) {
    const existing = sessions.get(input.artifactId);
    if (existing) {
      // The game moved to another conversation: cards left in the old one can no longer act on it.
      if (input.chatId && input.chatId !== existing.chatId) closeOpenNeedCards(existing);
      // Reopening returns to the step in progress; a finished platform returns to the link result.
      const home: GamePublishView = existing.linkUrl ? 'link-result' : 'home';
      const view: GamePublishView = existing.view === 'result'
        ? home
        : existing.view === 'list' ? (stepInProgress(existing) ? 'step' : home) : existing.view;
      update(input.artifactId, { open: true, view, chatId: input.chatId ?? existing.chatId });
      return;
    }
    sessions.set(input.artifactId, {
      ...input,
      open: true,
      view: 'home',
      stepIndex: 0,
      inputs: {},
      preparing: false,
      status: { tone: 'idle', key: 'Agent is ready' },
      linkPublishing: false,
      published: [],
    });
    emit();
  },
  close(artifactId: string) { update(artifactId, { open: false }); },
  /** Show the panel again for a game that already has publish state (e.g. from a conversation card). */
  reopen(artifactId: string) {
    const session = sessions.get(artifactId);
    if (session) gamePublishActions.open({ ...session, artifactId });
  },
  /** Bring the panel back to the step a conversation card belongs to, if that step is still the current one. */
  resumeStep(artifactId: string, ref: GamePublishStepRef) {
    const session = sessions.get(artifactId);
    if (!session || !matchesStep(session, ref) || session.view === 'working') return;
    update(artifactId, { open: true, view: 'step' });
  },
  toggle(input: { artifactId: string; chatId: string | null; gameId: string; gameTitle: string }) {
    if (sessions.get(input.artifactId)?.open) gamePublishActions.close(input.artifactId);
    else gamePublishActions.open(input);
  },
  showList(artifactId: string) { update(artifactId, { view: 'list' }); },
  showHome(artifactId: string) {
    const session = sessions.get(artifactId);
    update(artifactId, { view: session?.linkUrl ? 'link-result' : 'home' });
  },
  async publishLink(artifactId: string) {
    const session = sessions.get(artifactId);
    if (!session || session.linkPublishing) return;
    update(artifactId, { linkPublishing: true });
    pushEntry(session, { kind: 'user', key: 'Publish the game link' });
    let url = '';
    await runAgent(artifactId, 'Publishing the game link', undefined, async onLine => {
      ({ url } = await publishGameLink(session.gameId, LINK_PUBLISH_STEPS, { onLine }));
    });
    const latest = sessions.get(artifactId);
    if (!latest) return;
    // Only move to the link result if the user is still on the link screen; never pull them out of a platform step.
    update(artifactId, {
      linkUrl: url,
      linkPublishing: false,
      ...(latest.view === 'home' ? { view: 'link-result' as const, status: { tone: 'done' as const, key: 'Agent: all done' } } : {}),
    });
    pushEntry(latest, { kind: 'result', title: 'Live', detail: url, action: 'Copy link', link: true });
  },
  choose(artifactId: string, platformId: GamePublishPlatformId) {
    const session = sessions.get(artifactId);
    const platform = gamePublishPlatform(platformId);
    if (!session || !platform) return;
    closeOpenNeedCards(session);
    const run = (platformRuns.get(artifactId) ?? 0) + 1;
    platformRuns.set(artifactId, run);
    const isCurrent = () => platformRuns.get(artifactId) === run;
    update(artifactId, {
      platformId,
      stepIndex: 0,
      picked: undefined,
      inputs: {},
      view: 'step',
      preparing: platform.prepare.length > 0,
      status: { tone: 'done', key: 'Agent: ready for your step' },
    });
    const latest = sessions.get(artifactId)!;
    pushEntry(latest, { kind: 'user', key: 'Publish to {name}', name: platform.name });
    pushEntry(latest, { kind: 'need', platformId, stepIndex: 0, closed: false });
    if (platform.prepare.length) {
      void runAgent(artifactId, 'Preparing for {name}', platform.name, onLine =>
        prepareForPlatform(session.gameId, platformId, platform.prepare, { onLine }),
      isCurrent).then(() => {
        if (!isCurrent()) return;
        update(artifactId, { preparing: false, status: { tone: 'done', key: 'Agent: ready for your step' } });
      });
    }
  },
  pick(artifactId: string, option: string) { update(artifactId, { picked: option }); },
  setInput(artifactId: string, label: string, value: string) {
    const session = sessions.get(artifactId);
    if (session) update(artifactId, { inputs: { ...session.inputs, [label]: value } });
  },
  /** The user finished the current step (from the panel or the conversation card). */
  async completeStep(artifactId: string, from?: GamePublishStepRef) {
    // From a card: act only if the card's step is still current, even if the panel shows another screen.
    if (from) {
      const current = sessions.get(artifactId);
      if (!current || !matchesStep(current, from) || current.view === 'working') return;
      if (current.view !== 'step') update(artifactId, { view: 'step' });
    }
    const session = sessions.get(artifactId);
    const platform = gamePublishPlatform(session?.platformId);
    if (!session || !platform || session.view !== 'step') return;
    const step = platform.steps[session.stepIndex];
    if (step.pick && !session.picked) { update(artifactId, { open: true }); return; }
    const run = platformRuns.get(artifactId);
    const isCurrent = () => platformRuns.get(artifactId) === run;
    closeOpenNeedCards(session);
    pushEntry(session, { kind: 'user', key: step.cta });
    update(artifactId, { view: 'working' });
    // Wait for preparation that is still running, then run the Agent work for this step.
    while (isCurrent() && sessions.get(artifactId)?.preparing) await new Promise(resolve => setTimeout(resolve, 200));
    if (!isCurrent()) return;
    await runAgent(artifactId, step.working, undefined, onLine =>
      completeUserStep(session.gameId, platform.id, session.stepIndex, sessions.get(artifactId)?.inputs ?? {}, step.after, { onLine }),
    isCurrent);
    const latest = sessions.get(artifactId);
    if (!latest || !isCurrent()) return;
    const next = latest.stepIndex + 1;
    if (next < platform.steps.length) {
      update(artifactId, { stepIndex: next, view: 'step', status: { tone: 'done', key: 'Agent: ready for your step' } });
      pushEntry(sessions.get(artifactId)!, { kind: 'need', platformId: platform.id, stepIndex: next, closed: false });
      return;
    }
    update(artifactId, {
      stepIndex: platform.steps.length,
      view: 'result',
      published: latest.published.includes(platform.id) ? latest.published : [...latest.published, platform.id],
      status: { tone: 'done', key: 'Agent: all done' },
    });
    pushEntry(sessions.get(artifactId)!, { kind: 'result', title: platform.resultTitle, detail: platform.resultDetail, action: platform.resultAction, href: platform.resultHref });
  },
};

export function useGamePublishSession(artifactId: string | null | undefined): GamePublishSession | undefined {
  return useSyncExternalStore(subscribe, () => (artifactId ? sessions.get(artifactId) : undefined));
}

const EMPTY: GamePublishThreadEntry[] = [];
export function useGamePublishThread(chatId: string | null | undefined): GamePublishThreadEntry[] {
  return useSyncExternalStore(subscribe, () => (chatId ? threads.get(chatId) ?? EMPTY : EMPTY));
}

export function gamePublishSessionFor(artifactId: string): GamePublishSession | undefined { return sessions.get(artifactId); }

/** Test helper. */
export function resetGamePublishStore() { sessions.clear(); threads.clear(); entrySeq = 0; emit(); }

/** Copies the published link and reports the real outcome. */
export async function copyGamePublishLink(url: string | undefined, notify: ((message: string, tone?: 'info' | 'error') => void) | undefined, t: (key: string) => string) {
  if (!url) return;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await navigator.clipboard.writeText(full);
    notify?.(t('Link copied'));
  } catch {
    notify?.(t('Could not copy the link'), 'error');
  }
}
