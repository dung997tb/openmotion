import test from 'node:test';
import assert from 'node:assert/strict';
import { explorePreview, templateLibraryPreview } from '../shared/workspace-url.ts';
import { translations, languages, installationFallbackWelcome } from '../mcp-ui/template-recommendations/i18n.ts';

const origin = 'http://127.0.0.1:4173';
test('Explore handoff preserves workspace presentation without creating a project', () => {
  for (const embedded of [undefined, true, false]) {
    for (const presentation of [undefined, 'foreground', 'background', 'now']) {
      const result = explorePreview(origin, { embedded, presentation });
      const handoff = result.previewHandoff;
      assert.equal(result.target, 'explore');
      assert.equal(result.previewUrl, origin + '/explore' + (embedded === false ? '' : '?embed=1'));
      assert.equal(result.projectCreated, false);
      assert.equal(result.openedByHost, false);
      assert.equal(handoff.target, 'explore');
      assert.equal(handoff.previewUrl, result.previewUrl);
      assert.equal(handoff.placement, 'right');
      assert.equal(handoff.reuseExistingTab, true);
      assert.equal(handoff.presentation, presentation ?? 'foreground');
      assert.equal(handoff.focusPolicy, presentation === 'background' ? 'background' : presentation === 'now' ? 'switch_to_calling_chat' : 'preserve_current_chat');
      assert.equal(handoff.hostActionRequired, presentation !== 'background');
      assert.equal(handoff.state, presentation === 'background' ? 'background' : 'pending');
      assert.equal(handoff.openedByHost, false);
      if (presentation === 'background') assert.equal(handoff.nextAction, null);
      else {
        assert.equal(handoff.nextAction?.previewUrl, result.previewUrl);
        assert.equal(handoff.nextAction?.codex.arguments.target.url, result.previewUrl);
      }
      assert.match(handoff.instructions, /Confirm Explore is visible/);
      assert.match(handoff.instructions, /Do not create or select a project/);
    }
  }
  assert.equal(templateLibraryPreview(origin).previewUrl, origin + '/?templates=1&embed=1');
  assert.equal(templateLibraryPreview(origin, { embedded: false }).previewUrl, origin + '/?templates=1');
});

test('all seven welcomes distinguish Explore from the DSH library view', () => {
  for (const language of languages) {
    const { heading, discovery, libraryHeading, libraryDiscovery } = translations[language].welcome;
    assert.notEqual(heading, libraryHeading, language);
    assert.notEqual(discovery, libraryDiscovery, language);
    assert(libraryHeading && libraryDiscovery);
    assert.equal(installationFallbackWelcome(language, 'templates'), [libraryHeading, translations[language].welcome.introduction, libraryDiscovery].join('\n\n'));
    assert.equal(installationFallbackWelcome(language), [heading, translations[language].welcome.introduction, discovery].join('\n\n'));
  }
  assert.equal(translations.zh.welcome.heading, '🎉 OpenMotion 安装好啦，右侧就是探索页！');
  assert.equal(translations.zh.welcome.discovery, '点右上角「模板」进入模板库，支持搜索，找到喜欢的点击「复刻模板」就能开始你的创作！');
  assert.equal(translations.en.welcome.heading, '🎉 OpenMotion is installed. Explore is open on the right!');
  assert.equal(translations.en.welcome.discovery, 'Open Templates at the top right to search the library. When you find one you like, choose Recreate template to start creating!');
  assert.equal(translations.zh.welcome.libraryHeading, '🎉 OpenMotion 安装好啦，右侧就是模板库！');
});
