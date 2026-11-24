/**
 * Calls the publish wizard makes. Every call is a front-end mock: it resolves after a short
 * delay with fixed progress lines so the wizard can be reviewed end to end.
 *
 * TODO(backend): replace each mock with the real capability. Needed from the backend team:
 *  - publishGameLink: publish the game to a public link. The existing cloud publishing in
 *    `components/webPublishClient.ts` (targetKind 'game') already does this and can be reused.
 *  - prepareForPlatform: Agent adaptation and packaging per platform (WeChat Canvas adapter,
 *    Xiaohongshu offline package, Douyin ≤8 MB zip, itch.io HTML5 zip, Telegram script).
 *  - completeUserStep: upload/authorize after the user's step — WeChat miniprogram-ci upload with
 *    the user's upload key and IP allowlist, Xiaohongshu / Douyin Agent channels, itch.io butler
 *    push with the user's API key (stored encrypted), Telegram managed-bot creation, playable-ad
 *    export per network. Credentials must stay server-side; the UI never stores them.
 *  - review status callbacks so the conversation can report WeChat / Xiaohongshu / Douyin results.
 * Button-driven publishing must not call the language model; only adaptation work needs the Agent.
 */
import type { GamePublishPlatformId } from './platforms';

export interface GamePublishProgress {
  /** Called once per progress line, in order. */
  onLine: (line: string) => void;
}

const MOCK_LINE_DELAY_MS = 650;

function playLines(lines: readonly string[], progress: GamePublishProgress, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let index = 0;
    const tick = () => {
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      if (index >= lines.length) { resolve(); return; }
      progress.onLine(lines[index]);
      index += 1;
      setTimeout(tick, MOCK_LINE_DELAY_MS);
    };
    tick();
  });
}

/** Mock. TODO(backend): publish via webPublishClient and return the real public URL. */
export async function publishGameLink(gameId: string, lines: readonly string[], progress: GamePublishProgress, signal?: AbortSignal): Promise<{ url: string }> {
  await playLines(lines, progress, signal);
  return { url: `opendesign.games/${gameId.slice(0, 8)}` };
}

/** Mock. TODO(backend): Agent adaptation and packaging for the platform. */
export async function prepareForPlatform(_gameId: string, _platform: GamePublishPlatformId, lines: readonly string[], progress: GamePublishProgress, signal?: AbortSignal): Promise<void> {
  await playLines(lines, progress, signal);
}

/** Mock. TODO(backend): upload / authorize / submit after the user's step, using the values the user entered. */
export async function completeUserStep(
  _gameId: string,
  _platform: GamePublishPlatformId,
  _stepIndex: number,
  _inputs: Record<string, string>,
  lines: readonly string[],
  progress: GamePublishProgress,
  signal?: AbortSignal,
): Promise<void> {
  await playLines(lines, progress, signal);
}
