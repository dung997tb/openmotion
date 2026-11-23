import juicySplash from './mcp-gallery/juicy_splash.webp';
import darkPremium from './mcp-gallery/dark_premium.webp';
import colorPop from './mcp-gallery/color_pop.webp';
import flatLay from './mcp-gallery/flat_lay.webp';
import beforeAfter from './mcp-gallery/before_after.webp';
import isometricCard from './mcp-gallery/isometric_card.webp';
import cinematicLogo from './mcp-gallery/cinematic_logo.webp';
import glitchLogo from './mcp-gallery/glitch_logo.webp';
import livestreamClips from './mcp-gallery/livestream_clips.webp';
import bilingualCap from './mcp-gallery/bilingual_cap.webp';
import feltStop from './mcp-gallery/felt_stop.webp';
import handpainted from './mcp-gallery/handpainted.webp';

export const mcpGalleryCategories = [
  ['all', 'All'],
  ['ecom', 'E-commerce marketing'],
  ['brand', 'Brand & intros'],
  ['talk', 'Talking-head & editing'],
  ['style', 'Creative styles'],
] as const;

export type McpGalleryCategory = (typeof mcpGalleryCategories)[number][0];
export type McpGalleryCard = {
  id: string;
  category: Exclude<McpGalleryCategory, 'all'>;
  kind: 'editable' | 'recreate';
  duration: string;
  image: string;
  content: Record<string, { title: string; prompt: string }> & { en: { title: string; prompt: string } };
};

export const mcpGalleryPreview = {
  en: {
    pasteHint: 'Paste directly into your Agent',
    tracks: [
      ['Video', 'Shot 1 · Close-up push-in', 'Shot 2 · On-location footage', 'End card'],
      ['Captions & text', 'Title entrance', 'Key selling points', 'CTA badge'],
      ['Voice & music', 'Expressive voiceover and upbeat music'],
    ],
  },
  'zh-CN': {
    pasteHint: '可直接粘贴给你的 Agent',
    tracks: [
      ['视频主轨', '镜头 1 · 特写推近', '镜头 2 · 实景展示', '结尾定版'],
      ['字幕与花字', '主标题入场', '核心卖点大字卡', 'CTA 角标'],
      ['配音与音乐', '情绪旁白 + 节奏轻快 BGM（哪里不满意只换这一轨，画面不动）'],
    ],
  },
} as const;

export const mcpGalleryCards: readonly McpGalleryCard[] = [
  { id: 'juicy-splash', category: 'ecom', kind: 'editable', duration: '0:15', image: juicySplash, content: {
    en: {"title":"15-second juice splash product video","prompt":"@OpenDesign Turn this bottled drink image into a 15-second summer juice splash product video. Use saturated warm orange, three large selling points and a promotion badge."},
    'zh-CN': {"title":"饮品飞溅 15 秒电商主图视频","prompt":"@OpenDesign 把这张瓶装饮品图做成 15 秒夏日果汁飞溅主图视频，高饱和暖橙色调，加 3 个核心卖点大字与促销标签。"},
  } },
  { id: 'dark-premium', category: 'ecom', kind: 'editable', duration: '0:12', image: darkPremium, content: {
    en: {"title":"Black-and-gold luxury perfume launch","prompt":"@OpenDesign Use this perfume bottle photo for a 12-second dark black-and-gold film with a slow macro push-in, a minimal serif English title on the left and a low ambient music bed."},
    'zh-CN': {"title":"黑金香水高级质感发布短片","prompt":"@OpenDesign 用这张香水瓶实拍图生成 12 秒暗调黑金光影大片，缓慢微距推镜，左侧配极简衬线英文标题和低沉氛围乐。"},
  } },
  { id: 'color-pop', category: 'ecom', kind: 'editable', duration: '0:15', image: colorPop, content: {
    en: {"title":"High-contrast sparkling water social ad","prompt":"@OpenDesign Make this sparkling water can into a social clip with Klein blue, splashing ice, beat-matched cuts and a final 20% off when buying two badge."},
    'zh-CN': {"title":"高饱和撞色气泡水社媒广告","prompt":"@OpenDesign 把这罐气泡水做成克莱因蓝撞色冰块飞溅社媒短片，节奏卡点剪辑，结尾弹出 2 件 8 折促销角标。"},
  } },
  { id: 'flat-lay', category: 'ecom', kind: 'editable', duration: '0:18', image: flatLay, content: {
    en: {"title":"Skincare gift set flat-lay unboxing","prompt":"@OpenDesign Use these skincare flat-lay images for an 18-second relaxed unboxing clip with a floating 20% off sticker and handwritten Chinese product notes."},
    'zh-CN': {"title":"护肤礼盒俯拍开箱种草短片","prompt":"@OpenDesign 基于这组护肤品平铺图做 18 秒温柔慢节奏开箱种草片，带 20% OFF 悬浮小贴纸与中文手写体产品说明。"},
  } },
  { id: 'before-after', category: 'ecom', kind: 'editable', duration: '0:10', image: beforeAfter, content: {
    en: {"title":"Before-and-after product demo","prompt":"@OpenDesign Make a 10-second sliding before-and-after video from these two images, with a refreshed in 10 minutes title and clear comparison labels."},
    'zh-CN': {"title":"产品使用前后对比种草视频","prompt":"@OpenDesign 把这两张对比图做成 10 秒滑屏 Before/After 种草视频，顶部加「10 分钟焕新」标题卡与清晰对比标签。"},
  } },
  { id: 'isometric-card', category: 'brand', kind: 'editable', duration: '0:20', image: isometricCard, content: {
    en: {"title":"3D screen cards for a SaaS launch","prompt":"@OpenDesign Make a 20-second blue launch film with isometric UI cards flying in and three key features zoomed in one after another."},
    'zh-CN': {"title":"SaaS 新品功能 3D 卡片飞入","prompt":"@OpenDesign 给我司新版本发布做一条 20 秒蓝底 3D 等距 UI 卡片飞入宣传片，按 3 个核心功能依次放大聚焦。"},
  } },
  { id: 'cinematic-logo', category: 'brand', kind: 'editable', duration: '0:06', image: cinematicLogo, content: {
    en: {"title":"Cinematic metallic logo opener","prompt":"@OpenDesign Turn this brand mark into a six-second cinematic opener with dark golden beams, light particles and a low bass hit at the end."},
    'zh-CN': {"title":"电影级金属光效品牌片头","prompt":"@OpenDesign 把这个品牌图形做成 6 秒电影级暗金光束揭示片头，带微粒光斑与低频重低音收尾音效。"},
  } },
  { id: 'glitch-logo', category: 'brand', kind: 'editable', duration: '0:05', image: glitchLogo, content: {
    en: {"title":"Five-second cyber glitch logo opener","prompt":"@OpenDesign Make a five-second neon glitch logo opener with flashing RGB separation that holds on the mark for a technology or gaming channel."},
    'zh-CN': {"title":"赛博故障风 5 秒快闪片头","prompt":"@OpenDesign 生成一个 5 秒霓虹故障风 Logo 快闪片头，RGB 分离闪烁后定格主标，适配科技/游戏频道开场。"},
  } },
  { id: 'livestream-clips', category: 'talk', kind: 'recreate', duration: '0:30', image: livestreamClips, content: {
    en: {"title":"Turn a livestream into three vertical clips","prompt":"@OpenDesign Pick three compelling product segments from this two-hour livestream, crop them to 9:16 and add numbered title bars."},
    'zh-CN': {"title":"直播高光自动切 3 条竖屏短视频","prompt":"@OpenDesign 从这段 2 小时直播录像里挑出 3 个高转化单品讲解片段，自动裁成 9:16 竖屏并加上顶部编号标题条。"},
  } },
  { id: 'bilingual-cap', category: 'talk', kind: 'editable', duration: '0:25', image: bilingualCap, content: {
    en: {"title":"Animated bilingual talking-head captions","prompt":"@OpenDesign Add animated Chinese and English captions to this talking-head clip. Highlight key words, label the languages in the upper right and keep captions away from the speaker’s face."},
    'zh-CN': {"title":"口播中英双语动态字幕包装","prompt":"@OpenDesign 给这条口播视频自动生成中英双语字幕，重点关键词高亮弹跳，右上角加语言标识并保持安全区不遮脸。"},
  } },
  { id: 'felt-stop', category: 'style', kind: 'recreate', duration: '0:16', image: feltStop, content: {
    en: {"title":"Felt stop-motion explainer","prompt":"@OpenDesign Turn this product story into a warm 16-second wool-felt stop-motion animation with a gentle 12 fps wobble and cosy accordion music."},
    'zh-CN': {"title":"羊毛毡定格动画科普短片","prompt":"@OpenDesign 把这段产品故事转成 16 秒暖色羊毛毡手作定格动画风格，12fps 轻微抖动质感，配温馨手风琴背景音。"},
  } },
  { id: 'handpainted', category: 'style', kind: 'recreate', duration: '0:14', image: handpainted, content: {
    en: {"title":"Restyle real footage as hand-drawn illustration","prompt":"@OpenDesign Restyle this seaside footage as a 14-second warm retro illustration promo. Add a cinematic title in the upper left and keep the original smooth pan."},
    'zh-CN': {"title":"实拍空镜转复古手绘插画短片","prompt":"@OpenDesign 把这段海边实拍空镜重绘成温暖复古扁平插画风宣传片，左上角加电影级大标题，保留原镜头平滑摇移。"},
  } },
];
