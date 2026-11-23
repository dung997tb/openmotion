import { describe, expect, it } from 'vitest';
import type { GameCard } from '../../../../shared/game-contract';
import { isPlayableAdArtifact } from '../../../../shared/super-agent';
import { canChoosePlayableAd, isPlayableAd } from '../../super-agent/ModeComposerControls';
import { buildDirectGamePrompt, GAME_STUDIO_QUICK_IDEAS, readDirectGameBrief, toGameArtifact } from './gameSuperAgent';

const game = (patch: Partial<GameCard> = {}): GameCard => ({
  id: 'g1', title: 'Coin Cascade', description: 'Pull pins', genre: 'casual', style: '3d', setting: null, multiplayer: false, maxPlayers: 1,
  orientation: 'portrait', status: 'draft', cover: null, playUrl: '/api/games/g1/play/index.html', plays: 0, likes: 0, dislikes: 0,
  reaction: 0, favorite: false, source: 'mine', remixOf: null, controls: '', ...patch,
} as GameCard);

describe('playable ads in Super Agent', () => {
  it('counts only portrait briefs with the ad option on', () => {
    expect(isPlayableAd({ gameOrientation: 'portrait', gamePlayableAd: true })).toBe(true);
    expect(isPlayableAd({ gameOrientation: 'landscape', gamePlayableAd: true })).toBe(false);
    expect(isPlayableAd({ gameOrientation: 'portrait', gamePlayableAd: false })).toBe(false);
  });

  it('does not offer the ad option while a local template is selected, because remix copies it unchanged', () => {
    const base = { gameOrientation: 'portrait' as const, gamePlayableAd: true };
    expect(canChoosePlayableAd({ gameTemplate: game({ source: 'template' }) })).toBe(false);
    expect(isPlayableAd({ ...base, gameTemplate: game({ source: 'template' }) })).toBe(false);
    const community = game({ source: 'community', external: { url: 'https://x.test', author: 'a', postUrl: 'https://x.test/p', model: 'm', embeddable: true } });
    expect(isPlayableAd({ ...base, gameTemplate: community })).toBe(true);
  });

  it('tells the Super Agent turn to follow the playable-ad recipe only for ad drafts', () => {
    expect(buildDirectGamePrompt(game({ playableAd: true }), 'Build it')).toContain('format=playable ad');
    expect(buildDirectGamePrompt(game(), 'Build it')).not.toContain('playable ad');
    expect(toGameArtifact(game({ playableAd: true }), 'Coin Cascade').subtitle).toContain('Playable ad');
    expect(toGameArtifact(game({ playableAd: true }), 'Coin Cascade').playableAd).toBe(true);
    expect(isPlayableAdArtifact({ kind: 'game-project', subtitle: 'casual · Playable ad' })).toBe(true);
    expect(isPlayableAdArtifact({ kind: 'game-project', subtitle: 'casual · Game Studio' })).toBe(false);
  });

  it('recovers the user brief from saved game instructions', () => {
    const brief = '制作竖屏街机小游戏。\n支持快速重开。';
    const instruction = [
      `Use the openmotion-game Skill to build game g1 in this workspace. Read openmotion://workflow/game/start and openmotion_game_get with id=g1. Brief: 3d style, casual, modern setting. ${brief}`,
      '\nLayout: portrait 9:16 phone game. Design for upright play.',
      '\nFormat: playable ad. Follow the playable-ad recipe in the openmotion-game skill.',
      'Ask whether to publish to the local market only when the decision is missing.',
    ].join('\n');
    expect(readDirectGameBrief(buildDirectGamePrompt(game(), instruction), 'g1')).toBe(brief);
    const legacyInstruction = instruction.replace(
      'Ask whether to publish to the local market only when the decision is missing.',
      'Ask at most two short questions (multiplayer mode and local-market publication), only when missing.',
    );
    expect(readDirectGameBrief(buildDirectGamePrompt(game(), legacyInstruction), 'g1')).toBe(brief);
    const notes = '把画面改成暖色。';
    expect(readDirectGameBrief(buildDirectGamePrompt(game(), instruction, notes), 'g1')).toBe(notes);
    expect(readDirectGameBrief(buildDirectGamePrompt(game(), instruction), 'other-game')).toBeUndefined();
    expect(readDirectGameBrief(brief, 'g1')).toBeUndefined();
  });

  it('offers a portrait single-player playable-ad quick idea', () => {
    const idea = GAME_STUDIO_QUICK_IDEAS.find(item => item.playableAd);
    expect(idea).toMatchObject({ orientation: 'portrait' });
  });
});
