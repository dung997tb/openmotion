import { describe, expect, it } from 'vitest';
import type { GalleryTemplate } from '../../../shared/catalog';
import { matchesTemplateSearch, normalizedTemplateQuery, scoreTemplateSearch, templateSearchBrief, validReferenceLink } from './templateSearch';
import translations from '../i18n/template-search-ui.json';
import { languages, translate } from '../i18n/messages';
const t = (value: string) => value;
const entry = (fields: Partial<GalleryTemplate>): GalleryTemplate => ({ id: 'reference-one', title: 'A campaign', tags: [], kind: 'prism', ...fields });
it('localizes every search and recovery message in every supported non-English locale', () => {
  const keys = Object.keys(translations['zh-CN']);
  for (const { locale } of languages.filter(item => item.locale !== 'en')) {
    const dictionary = translations[locale as keyof typeof translations];
    expect(Object.keys(dictionary).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(translate(locale, key)).toBe(dictionary[key as keyof typeof dictionary]);
  }
});
describe('template-only search matching', () => {
  it('matches confirmed task semantics without assigning them to unrelated brands', () => {
    for (const word of ['产品演示', '功能演示', ' PRODUCT   DEMO ']) {
      expect(matchesTemplateSearch(entry({ id: 'product-promo' }), word, t)).toBe(true);
      expect(matchesTemplateSearch(entry({ uses: ['Product demo'] }), word, t)).toBe(true);
      expect(matchesTemplateSearch(entry({ uses: ['Brand promotion'] }), word, t)).toBe(false);
    }
  });
  it('matches task aliases against catalog purposes and falls back to localized search text', () => {
    const zh = (value: string) => translate('zh-CN', value);
    expect(matchesTemplateSearch(entry({ uses: ['Product demo'] }), '功能演示', zh)).toBe(true);
    expect(matchesTemplateSearch(entry({ title: 'AI 功能演示' }), '功能演示', zh)).toBe(true);
    expect(matchesTemplateSearch(entry({ uses: ['Product launch'] }), 'product promo', t)).toBe(true);
    expect(matchesTemplateSearch(entry({ title: 'Summer product promo' }), 'product promo', t)).toBe(true);
    expect(matchesTemplateSearch(entry({ uses: ['Brand promotion'] }), 'product promo', t)).toBe(false);
  });
  it('preserves names, ids and filters out incidental acronym substrings', () => {
    expect(matchesTemplateSearch(entry({ title: 'Anything goes' }), 'NYT', t)).toBe(false);
    expect(matchesTemplateSearch(entry({ id: 'nyt-graph' }), 'NYT', t)).toBe(true);
    expect(matchesTemplateSearch(entry({ title: 'Figma Motion' }), 'figma motion', t)).toBe(true);
    expect(normalizedTemplateQuery('  Product   Demo  ')).toBe('product demo');
  });
  it('supports Chinese natural-language queries, bilingual aliases, fuzzy typos, and relevance ordering', () => {
    const talkingHead = entry({ title: 'K3.1', tags: ['实拍剪辑', '字幕'], uses: ['Live-action editing'] });
    const explainer = entry({ title: '数据叙事模板', tags: ['数据叙事', '流程动画'], uses: ['Product demo'] });
    const ecommerce = entry({ title: 'Black Friday Sale', tags: ['活动推广'], uses: ['Event promotion'] });
    const logoItem = entry({ title: 'Qwen3.8 材质标志', tags: ['图形动效'], searchAliases: ['Material Logo Reveal'] });

    expect(matchesTemplateSearch(talkingHead, '口播', t)).toBe(true);
    expect(matchesTemplateSearch(explainer, '我想找一个科普讲解的视频模板', t)).toBe(true);
    expect(matchesTemplateSearch(ecommerce, '电商', t)).toBe(true);
    expect(matchesTemplateSearch(talkingHead, 'vlog', t)).toBe(true);
    expect(matchesTemplateSearch(logoItem, 'logo', t)).toBe(true);
    expect(matchesTemplateSearch(entry({ title: 'Smooth Animation' }), 'animaton', t)).toBe(true);

    const exact = entry({ id: 'exact', title: 'Logo Reveal' });
    const aliasOnly = entry({ id: 'alias', title: 'Brand Card', tags: ['标志'] });
    expect(scoreTemplateSearch(exact, 'logo', t)).toBeGreaterThan(scoreTemplateSearch(aliasOnly, 'logo', t));
  });
});
describe('reference handoff', () => {
  it('only accepts HTTP(S), without fetching or executing supplied references', () => {
    expect(validReferenceLink('https://example.com/video')).toBe(true);
    for (const value of ['javascript:alert(1)', 'file:///private/video.mp4', 'not a link']) expect(validReferenceLink(value)).toBe(false);
  });
  it('pins the same local video version for MCP and direct playback', () => {
    const mediaUrl = 'http://127.0.0.1:4173/motion-api/assets/asset/versions/version/file';
    const prompt = templateSearchBrief({
      mode: 'reference', source: 'local', query: 'launch', description: 'Our product',
      asset: { assetId: 'asset', versionId: 'version' }, mediaUrl,
    }, t);
    expect(prompt).toContain('openmotion_assets_use {"action":"read","assetId":"asset","versionId":"version"}');
    expect(prompt).toContain(mediaUrl);
    expect(prompt).toContain('Our product');
    expect(prompt).not.toContain('https:');
    expect(prompt).not.toContain('sent');
  });
});
