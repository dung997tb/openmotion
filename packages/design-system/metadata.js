import { brand, designSystemAsset } from './index.js';

// Product copy only: never derive share metadata from a project, session or local URL.
const copy = {
  en: ['Open-source AI Game & Video Studio. Turn ideas, templates and references into playable games and editable videos with your AI agent.', 'en_US'],
  'zh-CN': ['开源 AI 游戏与视频创作工作室。用 AI Agent 把创意、模板与参考变成可运行的游戏和可编辑视频，一站式生成图片、视频、音乐与配音。', 'zh_CN'],
  ja: ['オープンソースの AI ゲーム＆動画スタジオ。AI エージェントとアイデア・テンプレート・参考素材から遊べるゲームと編集可能な動画を制作。', 'ja_JP'],
  ko: ['오픈소스 AI 게임 & 비디오 스튜디오. AI 에이전트와 아이디어, 템플릿, 참고 자료로 플레이 가능한 게임과 편집 가능한 영상을 만드세요.', 'ko_KR'],
  de: ['Open-Source AI Game & Video Studio. Verwandle Ideen, Vorlagen und Referenzen mit deinem KI-Agenten in spielbare Games und editierbare Videos.', 'de_DE'],
  fr: ['Studio open-source IA pour jeux et vidéos. Transformez idées, modèles et références en jeux jouables et vidéos modifiables avec votre agent IA.', 'fr_FR'],
  ru: ['Открытая AI-студия для игр и видео. Превращайте идеи, шаблоны и референсы в игры и редактируемые видео вместе с ИИ-агентом.', 'ru_RU'],
  es: ['Estudio open-source de juegos y vídeo con IA. Convierte ideas, plantillas y referencias en juegos jugables y vídeos editables con tu agente de IA.', 'es_ES'],
  'pt-BR': ['Estúdio open-source de jogos e vídeo com IA. Transforme ideias, templates e referências em jogos jogáveis e vídeos editáveis com seu agente de IA.', 'pt_BR'],
  it: ['Studio open-source AI per giochi e video. Trasforma idee, modelli e riferimenti in giochi giocabili e video modificabili con il tuo agente IA.', 'it_IT'],
  tr: ['Açık kaynaklı AI Oyun ve Video Stüdyosu. Yapay zekâ ajanınızla fikirleri, şablonları ve referansları oynanabilir oyunlara ve düzenlenebilir videolara dönüştürün.', 'tr_TR'],
};

// Reuse the public README hero unchanged. Its immutable URL and attribution are
// recorded in repository-media.json and docs/readme/ASSETS.md.
export const socialImage = Object.freeze({
  url: 'https://releases.open-design.ai/open-motion/media/sha256/730e1d6235820d39ba8adde42810d1165377992136a3b20290ad5d504abb527b.jpg',
  width: 1586, height: 992, type: 'image/jpeg',
  alt: 'OpenMotion video recreation: a reference beside its remake, with the editable Studio timeline below.',
});

export function pageMetadata(locale = 'zh-CN') {
  const [description, ogLocale] = copy[locale] ?? copy.en;
  const title = `${brand.website.name} — ${brand.website.tagline}`;
  const shareTitle = `${brand.website.name} — Create with your AI agent`;
  return {
    title,
    name: { description, 'application-name': brand.website.name, 'apple-mobile-web-app-title': brand.website.name,
      robots: 'noindex, nofollow', 'color-scheme': 'light dark',
      'twitter:card': 'summary_large_image', 'twitter:title': shareTitle, 'twitter:description': description,
      'twitter:image': socialImage.url, 'twitter:image:alt': socialImage.alt },
    property: { 'og:type': 'website', 'og:site_name': brand.website.name, 'og:title': shareTitle,
      'og:description': description, 'og:locale': ogLocale, 'og:image': socialImage.url,
      'og:image:secure_url': socialImage.url, 'og:image:type': socialImage.type,
      'og:image:width': String(socialImage.width), 'og:image:height': String(socialImage.height), 'og:image:alt': socialImage.alt },
  };
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const faviconLinks = () => [
  `<link rel="icon" type="image/png" sizes="32x32" href="${designSystemAsset('brand/favicon-32.png')}" />`,
  `<link rel="icon" type="image/svg+xml" sizes="any" href="${designSystemAsset(brand.favicon)}?v=2" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="${designSystemAsset('brand/apple-touch-icon.png')}" />`,
].join('\n');

/** Static HTML and the hydrated UI use the same copy, including no-JS startup/errors. */
export function renderPageMetadata(locale = 'zh-CN', surface = 'studio') {
  const meta = pageMetadata(locale);
  if (surface === 'design-system') {
    meta.title = `${brand.website.name} · Design System`;
    meta.name.description = `${brand.website.name} 共享设计系统：颜色、字体、组件、图标与品牌资源。`;
    meta.name['twitter:title'] = meta.property['og:title'] = meta.title;
    meta.name['twitter:description'] = meta.property['og:description'] = meta.name.description;
  }
  return [
    `<title>${escape(meta.title)}</title>`,
    ...['name', 'property'].flatMap(attribute => Object.entries(meta[attribute]).map(([key, value]) =>
      `<meta ${attribute}="${key}" content="${escape(value)}" />`)),
    faviconLinks(),
  ].join('\n');
}
