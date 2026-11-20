import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyImageToHtml,
  briefMarkdown,
  draftSocialPosts,
  listHtmlImageTargets,
  runReadme,
  scenarioStarterPage,
  scriptOutline,
  socialPostsMarkdown,
} from '../shared/scenario-content.ts';
import {
  fillScenarioTemplate,
  findScenario,
  scenarioAgentPrompt,
  scenarioDefinitions,
  scenarioRecipeTools,
  scenarioRunAgentPrompt,
  socialPlatforms,
  type PageRecipeId,
} from '../shared/scenarios.ts';

test('scenarioStarterPage escapes untrusted brief content, includes slots and valid structure for every recipe', () => {
  const recipes: PageRecipeId[] = ['landing', 'sale', 'link-in-bio', 'code-animation'];
  const hostile = '<script>alert("xss")</script>Nova & Co';
  const brief = {
    productName: hostile,
    brandName: hostile,
    personaName: hostile,
    concept: hostile,
    idea: 'Launch fast with <img src=x onerror=alert(1)> safety',
    valueProps: ['Fast <b>setup</b>', 'Zero lock-in'],
    originalPrice: '$199',
    salePrice: '$99',
    promoCode: 'BF50',
    saleWindow: 'Nov 27 – Dec 1',
    pageUrl: 'javascript:alert(1)',
    cta: 'Buy now',
  };

  for (const recipe of recipes) {
    const files = scenarioStarterPage(recipe, brief, 'en');
    const html = files.find(f => f.path === 'index.html')?.content ?? '';
    const css = files.find(f => f.path === 'styles.css')?.content ?? '';
    assert.ok(html.length > 200, `${recipe} produces index.html`);
    assert.ok(css.length > 200, `${recipe} produces styles.css`);
    assert.ok(html.includes('<!DOCTYPE html>'), `${recipe} has doctype`);
    assert.ok(html.includes('</html>') && html.includes('</body>') && html.includes('</head>'), `${recipe} has closing tags`);
    assert.ok(html.includes('data-om-slot="hero"'), `${recipe} includes hero slot`);
    assert.ok(html.includes('data-om-slot="gallery"'), `${recipe} includes gallery slot`);
    assert.ok(!html.includes('<script>alert("xss")</script>'), `${recipe} escapes hostile script tag`);
    assert.ok(!html.includes('<img src=x'), `${recipe} escapes hostile img tag`);
    assert.ok(!html.includes('javascript:alert(1)'), `${recipe} blocks javascript: URL`);
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Nova &amp; Co'), `${recipe} preserves escaped text`);
  }

  const saleHtml = scenarioStarterPage('sale', brief, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(saleHtml.includes('$99') && saleHtml.includes('$199') && saleHtml.includes('BF50'));
  assert.ok(saleHtml.includes('data-om-slot="product"'));

  const bioHtml = scenarioStarterPage('link-in-bio', brief, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(bioHtml.includes('data-om-slot="avatar"'));

  const landingWithUrl = scenarioStarterPage('landing', { ...brief, pageUrl: 'https://example.com/launch' }, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(landingWithUrl.includes('href="https://example.com/launch"'));
});

test('listHtmlImageTargets finds slots and img tags across starter and template HTML', () => {
  const starterHtml = scenarioStarterPage('sale', { productName: 'Tote' }, 'en').find(f => f.path === 'index.html')!.content;
  const starterTargets = listHtmlImageTargets(starterHtml);
  const slotNames = starterTargets.filter(t => t.kind === 'slot').map(t => t.slot);
  assert.deepEqual(slotNames, ['hero', 'product', 'gallery']);

  const templateHtml = '<html><body><section data-om-slot="banner" data-om-label="Top Banner"><img src="./hero.png" alt="Hero" /><img src="./sub.jpg" alt="Detail" /></section></body></html>';
  const targets = listHtmlImageTargets(templateHtml);
  assert.deepEqual(targets, [
    { kind: 'slot', slot: 'banner', label: 'Top Banner' },
    { kind: 'img', index: 0, src: './hero.png', alt: 'Hero' },
    { kind: 'img', index: 1, src: './sub.jpg', alt: 'Detail' },
  ]);
});

test('applyImageToHtml handles slot, img-index and append targets idempotently with escaped alt', () => {
  const starter = scenarioStarterPage('landing', { productName: 'Prism' }, 'en').find(f => f.path === 'index.html')!.content;
  const escapedAlt = 'Hero "quoted" <tag>';

  // Container slot + idempotency
  const once = applyImageToHtml(starter, { kind: 'slot', slot: 'hero' }, './assets/hero-12345678.png', escapedAlt);
  assert.ok(once.includes('src="./assets/hero-12345678.png"'));
  assert.ok(once.includes('alt="Hero &quot;quoted&quot; &lt;tag&gt;"'));
  const twice = applyImageToHtml(once, { kind: 'slot', slot: 'hero' }, './assets/hero-12345678.png', escapedAlt);
  assert.equal(twice.match(/hero-12345678\.png/g)?.length, 1);

  // Direct <img data-om-slot>
  const directImg = '<html><body><img data-om-slot="hero" src="./old.png" alt="Old" /></body></html>';
  const replacedSlotImg = applyImageToHtml(directImg, { kind: 'slot', slot: 'hero' }, './assets/new.png', 'Fresh');
  assert.ok(replacedSlotImg.includes('src="./assets/new.png"') && replacedSlotImg.includes('alt="Fresh"'));

  // img index replacement
  const twoImgs = '<html><body><img src="./a.png" alt="A" /><img src="./b.png" alt="B" /></body></html>';
  const replacedSecond = applyImageToHtml(twoImgs, { kind: 'img', index: 1 }, './assets/c.png', 'C & D');
  assert.ok(replacedSecond.includes('src="./a.png"'));
  assert.ok(replacedSecond.includes('src="./assets/c.png"') && replacedSecond.includes('alt="C &amp; D"'));

  // append on plain HTML without gallery slot (and idempotency)
  const plain = '<html><body><h1>Hello</h1></body></html>';
  const appended = applyImageToHtml(plain, { kind: 'append' }, './assets/gal.png', 'Gallery');
  assert.ok(appended.includes('data-om-slot="gallery"'));
  assert.ok(appended.includes('src="./assets/gal.png"'));
  const appendedAgain = applyImageToHtml(appended, { kind: 'append' }, './assets/gal.png', 'Gallery');
  assert.equal(appendedAgain.match(/gal\.png/g)?.length, 1);
});

test('draftSocialPosts enforces platform character, hashtag and title limits, rotates variants and localizes zh-CN', () => {
  const blackFriday = findScenario('black-friday')!;
  const longIdea = 'Ultra-durable travel weekender built for holiday getaways '.repeat(25);
  const brief = {
    productName: 'Nomad Holiday Weekender Tote Deluxe Edition',
    idea: longIdea,
    salePrice: '$79',
    originalPrice: '$149',
    promoCode: 'BF40',
    saleWindow: 'Nov 27 – Dec 1',
  };
  const allPlatforms = socialPlatforms.map(p => p.id);
  const v0 = draftSocialPosts(blackFriday, brief, allPlatforms, { tone: 'bold', variant: 0, locale: 'en' });
  const v1 = draftSocialPosts(blackFriday, brief, allPlatforms, { tone: 'bold', variant: 1, locale: 'en' });

  assert.equal(v0.length, allPlatforms.length);
  for (const post of v0) {
    const spec = socialPlatforms.find(p => p.id === post.platform)!;
    assert.ok(Array.from(post.text).length <= spec.maxChars, `${post.platform} respects maxChars`);
    assert.ok(post.hashtags.length <= spec.maxHashtags, `${post.platform} respects maxHashtags`);
    if ('maxTitleChars' in spec && spec.maxTitleChars) {
      assert.ok(post.title && Array.from(post.title).length <= spec.maxTitleChars, `${post.platform} respects maxTitleChars`);
    }
  }
  assert.notEqual(v0[0].text, v1[0].text, 'Variant rotation produces different hooks/CTAs');

  const zhPosts = draftSocialPosts(blackFriday, brief, ['xiaohongshu', 'douyin'], { locale: 'zh-CN', variant: 0 });
  assert.match(zhPosts[0].text, /[\u4e00-\u9fff]/, 'zh-CN draft uses Chinese phrasing');
  assert.ok(zhPosts[0].title && Array.from(zhPosts[0].title).length <= 20, 'Xiaohongshu zh-CN title <= 20 chars');

  const md = socialPostsMarkdown(v0);
  assert.ok(md.includes('# Social posts') && md.includes('## X (16:9)'));

  const scriptEn = scriptOutline({ personaName: 'Mina', topic: 'Batch filming' }, 'en');
  const scriptZh = scriptOutline({ personaName: 'Mina', topic: '批量拍摄' }, 'zh-CN');
  assert.ok(scriptEn.includes('[Hook') && scriptEn.includes('Mina'));
  assert.match(scriptZh, /开场 Hook/);
});

test('fillScenarioTemplate handles missing fields gracefully and prompt builders include every required tool', () => {
  const filledPartial = fillScenarioTemplate('Hero image for {productName}: {valueProps}, {visualStyle}', { productName: 'Nova' });
  assert.equal(filledPartial, 'Hero image for Nova');
  assert.ok(!filledPartial.includes('{'));

  const filledList = fillScenarioTemplate('Hero image for {productName}: {valueProps}, {visualStyle}', {
    productName: 'Nova',
    valueProps: ['Fast', 'Local'],
    visualStyle: 'Minimalist',
  });
  assert.equal(filledList, 'Hero image for Nova: Fast, Local, Minimalist');

  for (const scenario of scenarioDefinitions) {
    const prompt = scenarioAgentPrompt(scenario, { integration: { previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' } });
    for (const tool of scenarioRecipeTools) {
      assert.ok(prompt.includes(tool), `${scenario.id} prompt includes ${tool}`);
    }
    assert.ok(prompt.includes('openmotion_assets_use'));
    assert.ok(prompt.includes('command=export'));
    assert.ok(prompt.includes('/fixture/data'));
  }

  const bf = findScenario('black-friday')!;
  const runPrompt = scenarioRunAgentPrompt(bf, {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Holiday Tote',
    revision: 3,
    brief: { productName: 'Holiday Tote' },
    activeStepId: 'detail-page',
    steps: {
      brief: { stepId: 'brief', status: 'done', activeIterationId: null, links: {} },
      'detail-page': { stepId: 'detail-page', status: 'in-progress', activeIterationId: null, links: { designProjectId: '22222222-2222-4222-8222-222222222222' } },
    },
    pool: [{
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'image',
      label: 'Hero shot',
      stepId: 'product-images',
      pinned: true,
      ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444444', versionId: '55555555-5555-4555-8555-555555555555' },
    }],
  }, { stepId: 'detail-page' });
  assert.ok(runPrompt.includes('11111111-1111-4111-8111-111111111111'));
  assert.ok(runPrompt.includes('expectedRevision: 3'));
  assert.ok(runPrompt.includes('44444444-4444-4444-8444-444444444444@55555555-5555-4555-8555-555555555555'));
  assert.ok(runPrompt.includes('22222222-2222-4222-8222-222222222222'));

  assert.ok(briefMarkdown(bf, { productName: 'Tote' }).includes('## Product name'));
  const readme = runReadme(bf, {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Holiday Tote',
    revision: 3,
    brief: {},
    activeStepId: 'brief',
    steps: {},
    pool: [],
  }, { origin: 'http://127.0.0.1:4173' });
  assert.ok(readme.includes('# Holiday Tote') && readme.includes('manifest.json'));
});
