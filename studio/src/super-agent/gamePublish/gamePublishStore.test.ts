import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePublishActions, gamePublishSessionFor, resetGamePublishStore } from './gamePublishStore';

const input = { artifactId: 'game:abc', chatId: 'chat-1', gameId: 'abc12345', gameTitle: 'Coin Jar' };

async function flush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('gamePublishStore', () => {
  beforeEach(() => { vi.useFakeTimers(); resetGamePublishStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens on the platform list and also publishes on OpenDesign by default', async () => {
    gamePublishActions.open(input);
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ view: 'list', alsoPublishLink: true });
    gamePublishActions.choose(input.artifactId, 'telegram');
    expect(gamePublishSessionFor(input.artifactId)?.linkPublishing).toBe(true);
    await flush(5000);
    const session = gamePublishSessionFor(input.artifactId)!;
    expect(session.linkUrl).toContain('abc12345');
    // The link runs alongside; the user stays on the platform step.
    expect(session).toMatchObject({ view: 'step', platformId: 'telegram' });
  });

  it('skips the OpenDesign link when the user unticks it', async () => {
    gamePublishActions.open(input);
    gamePublishActions.setAlsoPublishLink(input.artifactId, false);
    gamePublishActions.choose(input.artifactId, 'telegram');
    await flush(5000);
    const session = gamePublishSessionFor(input.artifactId)!;
    expect(session.linkPublishing).toBe(false);
    expect(session.linkUrl).toBeUndefined();
  });

  it('walks a platform one user step at a time and finishes from either surface', async () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'wechat');
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ view: 'step', stepIndex: 0, preparing: true });
    // Completing while preparation still runs waits for it, then runs the step's Agent work.
    const first = gamePublishActions.completeStep(input.artifactId);
    expect(gamePublishSessionFor(input.artifactId)?.view).toBe('working');
    await flush(10000);
    await first;
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ view: 'step', stepIndex: 1 });
    const second = gamePublishActions.completeStep(input.artifactId);
    await flush(5000);
    await second;
    const session = gamePublishSessionFor(input.artifactId)!;
    expect(session.view).toBe('result');
    expect(session.published).toEqual(['wechat']);
  });

  it('requires the user to choose a playable-ad network before continuing', async () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'playable-ad');
    gamePublishActions.close(input.artifactId);
    await gamePublishActions.completeStep(input.artifactId);
    // No network chosen: the panel reopens instead of advancing.
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ open: true, view: 'step', stepIndex: 0 });
    gamePublishActions.pick(input.artifactId, 'AppLovin');
    const next = gamePublishActions.completeStep(input.artifactId);
    await flush(5000);
    await next;
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ view: 'step', stepIndex: 1 });
  });

  it('switching platforms during preparation does not leave the new platform waiting forever', async () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'wechat');
    gamePublishActions.choose(input.artifactId, 'playable-ad');
    expect(gamePublishSessionFor(input.artifactId)?.preparing).toBe(false);
    gamePublishActions.pick(input.artifactId, 'Meta (≤2 MB)');
    const next = gamePublishActions.completeStep(input.artifactId);
    await flush(10000);
    await next;
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ platformId: 'playable-ad', view: 'step', stepIndex: 1 });
  });

  it('a finished link publish does not pull the user out of a platform step', async () => {
    gamePublishActions.open(input);
    const link = gamePublishActions.publishLink(input.artifactId);
    gamePublishActions.choose(input.artifactId, 'telegram');
    await flush(10000);
    await link;
    const session = gamePublishSessionFor(input.artifactId)!;
    expect(session.linkUrl).toBeTruthy();
    expect(session).toMatchObject({ view: 'step', platformId: 'telegram' });
  });

  it('a conversation card resumes its step after the user went back to the platform list', async () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'telegram');
    gamePublishActions.showList(input.artifactId);
    gamePublishActions.resumeStep(input.artifactId, { platformId: 'telegram', stepIndex: 0 });
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ view: 'step', platformId: 'telegram' });
    gamePublishActions.showList(input.artifactId);
    const done = gamePublishActions.completeStep(input.artifactId, { platformId: 'telegram', stepIndex: 0 });
    await flush(10000);
    await done;
    expect(gamePublishSessionFor(input.artifactId)?.view).toBe('result');
  });

  it('a stale card for another platform or step does nothing', async () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'itch');
    await gamePublishActions.completeStep(input.artifactId, { platformId: 'wechat', stepIndex: 0 });
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ platformId: 'itch', view: 'step', stepIndex: 0 });
  });

  it('reopening returns to the step in progress', () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'telegram');
    gamePublishActions.close(input.artifactId);
    gamePublishActions.reopen(input.artifactId);
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ open: true, view: 'step', platformId: 'telegram' });
  });
});
