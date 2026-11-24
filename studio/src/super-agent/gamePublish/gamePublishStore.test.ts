import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePublishActions, gamePublishSessionFor, resetGamePublishStore } from './gamePublishStore';

const input = { artifactId: 'game:abc', chatId: 'chat-1', gameId: 'abc12345', gameTitle: 'Coin Jar' };

async function flush(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('gamePublishStore', () => {
  beforeEach(() => { vi.useFakeTimers(); resetGamePublishStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens on the game link first and publishes it', async () => {
    gamePublishActions.open(input);
    expect(gamePublishSessionFor(input.artifactId)?.view).toBe('home');
    const done = gamePublishActions.publishLink(input.artifactId);
    await flush(5000);
    await done;
    const session = gamePublishSessionFor(input.artifactId)!;
    expect(session.view).toBe('link-result');
    expect(session.linkUrl).toContain('abc12345');
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

  it('reopening returns to the step in progress', () => {
    gamePublishActions.open(input);
    gamePublishActions.choose(input.artifactId, 'telegram');
    gamePublishActions.close(input.artifactId);
    gamePublishActions.reopen(input.artifactId);
    expect(gamePublishSessionFor(input.artifactId)).toMatchObject({ open: true, view: 'step', platformId: 'telegram' });
  });
});
