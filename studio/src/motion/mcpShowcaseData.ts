import { designSystemAsset } from '../../../packages/design-system/index.js';
import darkPremium from './mcp-gallery/dark_premium.webp';
import juicySplash from './mcp-gallery/juicy_splash.webp';
import liquidGlass from './mcp-gallery/liquid_glass.webp';
import lunarShot from './mcp-gallery/lunar_shot.webp';
import mgPlacement from './mcp-gallery/mg_placement.webp';
import multicam from './mcp-gallery/multicam.webp';
import speakerRoom from './mcp-gallery/speaker_room.webp';
import stickerPeel from './mcp-gallery/sticker_peel.webp';
import surreal3d from './mcp-gallery/surreal_3d.webp';
import talkingHead from './mcp-gallery/talking_head.webp';

export type LocalizedPair<T> = { en: T; 'zh-CN': T };

export type McpHeroBeat = {
  id: string;
  num: string;
  image: string;
  content: LocalizedPair<{ title: string; desc: string; prompt: string; alt: string }>;
};

export type McpModelPill = {
  label: string;
  icon: string;
};

export type McpShowcaseSlide = {
  id: string;
  image: string;
  content: LocalizedPair<{ tabLabel: string; title: string; prompt: string }>;
};

export type McpShowcaseModule = {
  id: string;
  anchorId?: string;
  title: LocalizedPair<string>;
  models: readonly McpModelPill[];
  slides: readonly McpShowcaseSlide[];
};

export type McpAdvantagePillar = {
  num: string;
  titleKey: string;
  bodyKey: string;
};

export type McpQuickFaqItem = {
  id: string;
  questionKey: string;
  answerKey: string;
};

const modelIcon = (file: string) => designSystemAsset(file);

export const mcpHeroBeats: readonly McpHeroBeat[] = [
  {
    id: 'brief',
    num: '01',
    image: darkPremium,
    content: {
      en: {
        title: 'Send one brief in chat',
        desc: 'Attach a product photo or state your goal — no complex parameter forms.',
        prompt: 'Use this perfume bottle photo to create a 12-second dark black-and-gold launch film with a slow push-in and moody ambient score.',
        alt: 'Dark black-and-gold product launch showcase',
      },
      'zh-CN': {
        title: '聊天框发一句需求',
        desc: '附商品图或直接说目标，免配复杂参数',
        prompt: '用这张香水图生成 12 秒暗调黑金发布短片，缓慢推镜并配低沉氛围乐',
        alt: '黑金高级质感发布大片',
      },
    },
  },
  {
    id: 'scene',
    num: '02',
    image: speakerRoom,
    content: {
      en: {
        title: 'Auto staging & camera moves',
        desc: 'Turn plain packshots into lit scenes with motion, captions and music.',
        prompt: 'Place this white-background speaker on a warm sunlit living-room table with natural lighting, selling-point captions and upbeat music.',
        alt: 'Warm living-room product showcase',
      },
      'zh-CN': {
        title: '自动换景与分镜生成',
        desc: '白底图直出实景布光、运镜与字幕配乐',
        prompt: '把这张白底音箱放进暖光客厅桌面，补全真实光影、卖点字幕与轻快配乐',
        alt: '白底商品图变暖光实景大片',
      },
    },
  },
  {
    id: 'variety',
    num: '03',
    image: juicySplash,
    content: {
      en: {
        title: 'Multi-category visual polish',
        desc: 'E-commerce ads, alpha motion overlays and talking-head recreations in one flow.',
        prompt: 'Turn this juice bottle into a 10-second summer splash spot with punchy pacing and bold high-contrast headline captions.',
        alt: 'High-contrast summer beverage splash ad',
      },
      'zh-CN': {
        title: '多品类爆款质感一键出',
        desc: '电商、透明动效与口播复刻一站全搞定',
        prompt: '用这张果汁包装做 10 秒夏日飞溅短片，节奏明快并叠加撞色卖点大字幕',
        alt: '夏日饮品飞溅电商大片',
      },
    },
  },
  {
    id: 'studio',
    num: '04',
    image: lunarShot,
    content: {
      en: {
        title: 'Refine in Studio & export MP4',
        desc: 'Tweak voiceover, captions or a single shot without re-rolling the whole film.',
        prompt: 'Change shot 2 to a slower low-angle push-in, ease the voiceover pace slightly, and export a 1080p MP4.',
        alt: 'Editable 3D camera showcase ready for Studio refinement',
      },
      'zh-CN': {
        title: '进 Studio 精调 / 导出 MP4',
        desc: '只改配音、字幕或单镜头，不用整片重抽',
        prompt: '把第 2 个镜头换成缓慢低机位推近，旁白语速放慢一点，直接导出 1080p MP4',
        alt: '单图 3D 运镜与 Studio 可编辑成片',
      },
    },
  },
];

export const mcpShowcaseModules: readonly McpShowcaseModule[] = [
  {
    id: 'band-ecom',
    title: {
      en: 'Product & brand films from a single shot',
      'zh-CN': '商品与品牌大片直出',
    },
    models: [
      { label: 'GPT Image 2.6', icon: modelIcon('providers/openai.svg') },
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
      {
        id: 'ecom-warm',
        image: speakerRoom,
        content: {
          en: {
            tabLabel: 'Warm lifestyle',
            title: 'Turn a packshot into a 15-second commerce spot',
            prompt: 'Use this white-background product image to make a 15-second warm living-room ad: close-up push-in for the first 3 seconds, cut to tabletop texture shots, add bold captions and upbeat music.',
          },
          'zh-CN': {
            tabLabel: '暖光实景',
            title: '白底商品图直出 15 秒带货大片',
            prompt: '用这张白底商品图，做一条 15 秒暖光客厅氛围带货短视频：前 3 秒特写推近，中段切桌面实景展示质感，加中文大字幕和轻快配乐。',
          },
        },
      },
      {
        id: 'ecom-noir',
        image: darkPremium,
        content: {
          en: {
            tabLabel: 'Black & gold',
            title: 'Dark black-and-gold luxury launch teaser',
            prompt: 'Turn this perfume bottle photo into a 12-second dark black-and-gold launch film with a slow macro push-in, drifting smoke light, minimal serif headline on the left and a deep ambient score.',
          },
          'zh-CN': {
            tabLabel: '黑金大片',
            title: '暗调黑金高级质感发布短片',
            prompt: '用这张香水瓶实拍图生成 12 秒暗调黑金发布短片：缓慢微距推镜，烟雾光影环绕，左侧配极简衬线大标题与低沉氛围乐。',
          },
        },
      },
      {
        id: 'ecom-summer',
        image: juicySplash,
        content: {
          en: {
            tabLabel: 'Summer burst',
            title: 'High-contrast fruit splash social spot',
            prompt: 'Turn this bottled juice photo into a 15-second summer ice-splash spot with saturated warm orange grading, beat-matched cuts, three headline selling points and a promo badge.',
          },
          'zh-CN': {
            tabLabel: '夏日爆款',
            title: '高饱和果汁飞溅社媒爆款短片',
            prompt: '用这张瓶装果汁图做 15 秒夏日冰块飞溅带货短片：高饱和暖橙色调，快节奏卡点切镜，加 3 个核心卖点大字与促销标签。',
          },
        },
      },
    ],
  },
  {
    id: 'band-alpha',
    anchorId: 'band-3d',
    title: {
      en: 'Alpha-ready motion assets & 3D camera moves',
      'zh-CN': '免抠透明动效与 3D 运镜',
    },
    models: [
      { label: 'Flux', icon: modelIcon('providers/models/flux.svg') },
      { label: 'Wan 2.7', icon: modelIcon('providers/models/alibaba-color.svg') },
      { label: 'ElevenLabs', icon: modelIcon('providers/models/elevenlabs.svg') },
    ],
    slides: [
      {
        id: 'alpha-sticker',
        image: stickerPeel,
        content: {
          en: {
            tabLabel: 'Sticker peel',
            title: 'Transparent motion stickers without green screen',
            prompt: 'Generate a 4-second sticker-peel reveal with a transparent background in brand teal and off-white, transitioning cleanly into a liquid-glass logo entrance.',
          },
          'zh-CN': {
            tabLabel: '撕贴纸转场',
            title: '免绿幕直出透明动效贴纸',
            prompt: '生成一个 4 秒撕贴纸揭示动效（带透明背景），配色用品牌青绿配米白，结尾自然衔接到我的品牌 Logo 液态玻璃入场。',
          },
        },
      },
      {
        id: 'alpha-glass',
        image: liquidGlass,
        content: {
          en: {
            tabLabel: 'Liquid glass Logo',
            title: 'Refractive liquid-glass brand logo intro',
            prompt: 'Build a 5-second transparent liquid-glass refracting logo intro from my brand mark with smooth specular sweep, ready to export as alpha WebM or ProRes.',
          },
          'zh-CN': {
            tabLabel: '液态玻璃 Logo',
            title: '液态玻璃折射品牌 Logo 片头',
            prompt: '基于我的品牌图形生成 5 秒透明底液态玻璃折射 Logo 片头，高光流动柔和，导出带 Alpha 通道的 WebM / ProRes。',
          },
        },
      },
      {
        id: 'alpha-3d',
        image: surreal3d,
        content: {
          en: {
            tabLabel: 'Single-image 3D',
            title: 'Cinematic 3D camera orbit & synced voiceover',
            prompt: 'Create an 8-second 3D orbit push-in from this concept still: hold 2 seconds of quiet space at the start, then bring in a warm restrained voiceover reading our slogan over soft ambience.',
          },
          'zh-CN': {
            tabLabel: '单图 3D 运镜',
            title: '单图直出电影感 3D 运镜与旁白',
            prompt: '基于这张概念图做 8 秒 3D 环绕推镜，开头 2 秒安静留白，随后用温润克制的女声念品牌 Slogan，叠加柔和环境音效。',
          },
        },
      },
    ],
  },
  {
    id: 'band-recreate',
    title: {
      en: '1:1 viral recreation & editable multi-track Studio',
      'zh-CN': '爆款复刻与可编辑多轨工程',
    },
    models: [
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Google Veo', icon: modelIcon('providers/models/google-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
      {
        id: 'recreate-talk',
        image: talkingHead,
        content: {
          en: {
            tabLabel: 'Pacing recreation',
            title: '1:1 pacing recreation with local edits anytime',
            prompt: 'Recreate the cut rhythm and bold black-card typography of this viral talking-head clip, swap in our 3 launch highlights, keep the caption motion and open in Studio for fine tuning.',
          },
          'zh-CN': {
            tabLabel: '口播节奏复刻',
            title: '1:1 复刻爆款节奏，局部随时可改',
            prompt: '复刻这条爆款口播的剪辑节奏和黑底大字卡样式，把文案替换成我们新品的 3 个核心卖点，保留原字幕动效并在 Studio 中打开微调。',
          },
        },
      },
      {
        id: 'recreate-multicam',
        image: multicam,
        content: {
          en: {
            tabLabel: 'Auto multicam',
            title: 'Automatic multi-camera cuts & kinetic highlights',
            prompt: 'Cut this two-camera interview automatically by active speaker and natural pauses, punch in on key takeaways with animated keyword bars, and deliver an editable multi-track Studio project.',
          },
          'zh-CN': {
            tabLabel: '多机位自动切',
            title: '多机位访谈自动切镜与高亮字幕',
            prompt: '把这段双机位访谈自动按说话人和停顿切镜，重点金句自动放大景别并弹出关键词字幕条，导出多轨 Studio 工程。',
          },
        },
      },
      {
        id: 'recreate-mg',
        image: mgPlacement,
        content: {
          en: {
            tabLabel: 'Talking-head + MG',
            title: 'Auto-placed motion cards & data callouts',
            prompt: 'Insert lightweight motion graphic cards and chart callouts wherever metrics or features are mentioned in this talking-head video, keeping cohesive styling with every card individually editable.',
          },
          'zh-CN': {
            tabLabel: '口播 + MG 植入',
            title: '口播自动植入 MG 动效与数据卡片',
            prompt: '给这条口播视频在提到数据与功能点时自动插入轻量 MG 动效卡片与图表高亮，保持整体配色统一且每张卡片可单独修改。',
          },
        },
      },
    ],
  },
];

export const mcpAdvantagePillars: readonly McpAdvantagePillar[] = [
  {
    num: '01',
    titleKey: 'Deliver editable projects, not throwaway clips',
    bodyKey: 'Stop re-rolling an entire video just to change one line. Every result saves as a multi-track Studio project so voiceover, captions and single shots stay editable.',
  },
  {
    num: '02',
    titleKey: 'One pipeline from concept to final cut',
    bodyKey: 'Images, video, alpha motion graphics, voiceover captions and MP4 rendering live in one connected workflow — just describe the outcome you want.',
  },
  {
    num: '03',
    titleKey: 'Free to connect and refine; pay only for generation',
    bodyKey: 'Connection checks, template browsing and local Studio edits cost nothing. Use your OpenDesign account or plug in your own BYOK provider keys.',
  },
];

export const mcpQuickFaq: readonly McpQuickFaqItem[] = [
  {
    id: 'billing',
    questionKey: 'Does connecting MCP charge me right away?',
    answerKey: 'No. Checking the connection, listing templates, reading projects and local Studio edits are free. Credits or provider fees apply only when you run cloud multimodal generation.',
  },
  {
    id: 'keys',
    questionKey: 'Do I have to configure every model API key myself?',
    answerKey: 'No. Sign in with your OpenDesign account in Model providers to use the unified model pool, or connect your own BYOK provider keys whenever you prefer.',
  },
  {
    id: 'editable',
    questionKey: 'If I want to tweak a result, do I have to regenerate the whole video?',
    answerKey: 'No. Every finished cut stays an editable multi-track Studio project. Swap voiceover, tweak captions or replace a single shot while keeping every other track intact.',
  },
  {
    id: 'merge',
    questionKey: 'Will installing overwrite my existing MCP servers?',
    answerKey: 'No. Setup instructions merge OpenMotion incrementally into your Agent config and preserve all existing MCP servers and local projects.',
  },
  {
    id: 'privacy',
    questionKey: 'Are my local product photos and project files safe?',
    answerKey: 'Projects and assets stay in your local workspace directory. Only the prompt and reference frames needed for a selected cloud generation job are sent to that provider.',
  },
  {
    id: 'export',
    questionKey: 'Which export formats are supported?',
    answerKey: 'Export 1080p/4K MP4 across 16:9, 9:16, 1:1, 4:3 and 3:4 aspect ratios, plus transparent alpha WebM and ProRes for motion graphics overlays.',
  },
];
