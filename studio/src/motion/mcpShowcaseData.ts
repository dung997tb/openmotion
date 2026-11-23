import { brandCatalogFile } from '../../../shared/brand-catalog';
import { designSystemAsset } from '../../../packages/design-system/index.js';
import facelessExplainerPoster from './mcp-gallery/faceless_explainer.webp';
import { motionSkills } from './skillCatalog';

export type LocalizedPair<T> = { en: T; 'zh-CN': T };

export type McpCaseTarget =
  | { kind: 'template'; templateId: string; title: string; posterUrl: string; previewUrl: string }
  | { kind: 'skill'; skillId: string }
  | { kind: 'brand-kit'; brandKitId: string; showcaseUrl: string };

/** Keep visible showcase copy clean while attaching the exact machine ID on copy for Agents. */
export function formatMcpAgentPrompt(displayPrompt: string, target?: McpCaseTarget | null): string {
  const base = displayPrompt.startsWith('@OpenDesign ') ? displayPrompt : `@OpenDesign ${displayPrompt}`;
  if (!target) return base;
  if (target.kind === 'template') return `${base}\n[OpenMotion template: ${target.templateId}]`;
  if (target.kind === 'skill') return `${base}\n[OpenMotion skill: ${target.skillId}]`;
  return `${base}\n[OpenMotion brand-kit: ${target.brandKitId}]`;
}

export type McpHeroBeat = {
  id: string;
  num: string;
  image: string;
  video?: string;
  target: McpCaseTarget;
  content: LocalizedPair<{ title: string; desc: string; prompt: string; alt: string }>;
};

export type McpModelPill = {
  label: string;
  icon: string;
};

export type McpShowcaseSlide = {
  id: string;
  image: string;
  video?: string;
  showcaseIframe?: string;
  target: McpCaseTarget;
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

function skillMedia(id: string, fallbackPoster?: string) {
  const skill = motionSkills.find(item => item.id === id);
  return {
    poster: fallbackPoster ?? skill?.cover?.poster ?? '',
    video: skill?.cover?.video,
  };
}

// Verified high-usage, high-export OpenMotion templates from library/templates/catalog.
const TEMPLATE_MEDIA = {
  figmaMotion: {
    id: 'motion-e6ac921a-f56f-4170-a2be-938cec5d028b',
    title: 'Config 2026 · Figma Motion',
    cover: 'https://r.open-design.ai/files/0ec5ba7c6a646778e5f74f162e92ab88322eae0db8a3716cc5a6799a494d4df4',
    preview: 'https://r.open-design.ai/files/d4b2bd6881774c3ac7b836cc4ec7ba178eecd63c9f1d9a184521b473992e8616',
  },
  aesthetics: {
    id: 'motion-46f34492-8ba1-4ba5-ac6e-4b4a13c80373',
    title: 'Aesthetics',
    cover: 'https://r.open-design.ai/files/7b1792797ce5d80635ecf6f76b5bd87c502bf01a338d46005484c3bb9aaba229',
    preview: 'https://r.open-design.ai/files/4809294d3cc0fe08f51909002ccf415d64d1334609088bd67d5dcac52851e1b7',
  },
  framer3: {
    id: 'motion-5805e419-651f-45b7-90be-302c93f79b21',
    title: 'Framer 3.0',
    cover: 'https://r.open-design.ai/files/7db8691e31ddc65e9e5475f170fd4e006cdca967682ff7e42ce95b74c40f071d',
    preview: 'https://r.open-design.ai/files/ba8da3f154c37fb36463089b4644efa497e9a22ed90f3d656399942dea4b9c53',
  },
  jitterAgents: {
    id: 'motion-f53dad52-9f20-42c5-b5c3-00743ea475b3',
    title: 'Jitter Superagents',
    cover: 'https://r.open-design.ai/files/f7178106d35ee0aadc3e3f1f4f8018186a6b9a986d2b2a5e489b335304195eb4',
    preview: 'https://r.open-design.ai/files/a2d2f2556b68cb578fa536f26b9c42a1506ef920135fbb0ec097d91b62e0eaff',
  },
  qwenMark: {
    id: 'motion-38b9c70f-cf58-4555-a50e-30c17479ba1e',
    title: 'Qwen3.8-Max',
    cover: 'https://r.open-design.ai/files/dff349b1d9bbf29b07eb7781fdaaef2cb32393e52c067ca095ae17f91fa3b7d8',
    preview: 'https://r.open-design.ai/files/f5b921cad56d5942172c1ad9b3e02363593b5909fc07c1c69eef0199778b1511',
  },
  cyeraBrand: {
    id: 'motion-f9bf74bb-fb65-4430-97b9-71ae5d7b3397',
    title: 'Cyera Research Labs',
    cover: 'https://r.open-design.ai/files/5ee01db592821debd81705d3fe4bb0dd87f883c8899decc0e67998a3f5740815',
    preview: 'https://r.open-design.ai/files/038e15a103a0d37cef63702b36c378026b4b4b3290766655589a873b592bd0fa',
  },
} as const;

const motionmaxxingMedia = skillMedia('motionmaxxing');
const facelessMedia = skillMedia('higgsfield-faceless-video', facelessExplainerPoster);
const paperCollageMedia = skillMedia('openmotion-paper-collage-explainer');

export const mcpHeroBeats: readonly McpHeroBeat[] = [
  {
    id: 'brief',
    num: '01',
    image: TEMPLATE_MEDIA.figmaMotion.cover,
    video: TEMPLATE_MEDIA.figmaMotion.preview,
    target: {
      kind: 'template',
      templateId: TEMPLATE_MEDIA.figmaMotion.id,
      title: TEMPLATE_MEDIA.figmaMotion.title,
      posterUrl: TEMPLATE_MEDIA.figmaMotion.cover,
      previewUrl: TEMPLATE_MEDIA.figmaMotion.preview,
    },
    content: {
      en: {
        title: 'Start from a proven launch template',
        desc: 'Describe your release — match real UI motion, timeline pacing and headlines.',
        prompt: `Use OpenMotion template "Config 2026 · Figma Motion" to build our feature launch film with synchronized UI interactions and deliver HTML + MP4.`,
        alt: 'Config 2026 Figma Motion product launch showcase',
      },
      'zh-CN': {
        title: '选高出片发布模板起步',
        desc: '说清新品亮点，直接套用真实界面动效与发布节奏',
        prompt: `基于模板「Config 2026 发布 Figma Motion」制作我们的新功能发布片，保留时间线与界面同步动效并交付 HTML 与 MP4。`,
        alt: 'Config 2026 发布 Figma Motion 产品发布动效',
      },
    },
  },
  {
    id: 'scene',
    num: '02',
    image: TEMPLATE_MEDIA.framer3.cover,
    video: TEMPLATE_MEDIA.framer3.preview,
    target: {
      kind: 'template',
      templateId: TEMPLATE_MEDIA.framer3.id,
      title: TEMPLATE_MEDIA.framer3.title,
      posterUrl: TEMPLATE_MEDIA.framer3.cover,
      previewUrl: TEMPLATE_MEDIA.framer3.preview,
    },
    content: {
      en: {
        title: 'Choreograph brand & product scenes',
        desc: 'Carry one lighting and colour motif across product demos and glass transitions.',
        prompt: `Adapt "Framer 3.0 Brand & Product Launch" for our v3 release: keep the blue glass lighting transitions, insert our product screens and export 1080p MP4.`,
        alt: 'Framer 3.0 brand and product launch film',
      },
      'zh-CN': {
        title: '自动编排品牌与产品分镜',
        desc: '用统一光影与材质线索串联界面展示与玻璃转场',
        prompt: `基于「Framer 3.0 品牌与产品发布」生成我们的新版本发布短片，保留蓝色光影与玻璃符号转场，替换成我方界面并导出 1080p MP4。`,
        alt: 'Framer 3.0 品牌与产品发布短片',
      },
    },
  },
  {
    id: 'variety',
    num: '03',
    image: motionmaxxingMedia.poster,
    video: motionmaxxingMedia.video,
    target: { kind: 'skill', skillId: 'motionmaxxing' },
    content: {
      en: {
        title: 'Layer Skills to remove the AI look',
        desc: 'Apply anti-slop typography, spring curves and editorial pacing automatically.',
        prompt: 'Use OpenMotion Skill "Remove the AI look from motion" (motionmaxxing) to upgrade our promo cut: strip generic slide cards and fake glow, tighten kinetic typography and export MP4.',
        alt: 'Remove the AI look from motion before-and-after showcase',
      },
      'zh-CN': {
        title: '叠加 Skill 去掉动效 AI 味',
        desc: '自动去掉简陋文字卡与假发光，按设计师级排版与缓动重制',
        prompt: '调用 OpenMotion Skill「去掉动效的 AI 味」（motionmaxxing）重制这条宣传片：去掉模板文字卡和廉价发光，换成设计师级动态排版与节奏后导出 MP4。',
        alt: '去掉动效的 AI 味前后质感对比',
      },
    },
  },
  {
    id: 'studio',
    num: '04',
    image: TEMPLATE_MEDIA.jitterAgents.cover,
    video: TEMPLATE_MEDIA.jitterAgents.preview,
    target: {
      kind: 'template',
      templateId: TEMPLATE_MEDIA.jitterAgents.id,
      title: TEMPLATE_MEDIA.jitterAgents.title,
      posterUrl: TEMPLATE_MEDIA.jitterAgents.cover,
      previewUrl: TEMPLATE_MEDIA.jitterAgents.preview,
    },
    content: {
      en: {
        title: 'Refine in Studio & export MP4',
        desc: 'Offset tracks, tweak copy or resize aspect ratios without re-rolling the cut.',
        prompt: `Use template "Jitter Superagents" to turn our workflow prompt into an editable multi-track Studio project, then adapt it for 16:9 and 9:16 exports.`,
        alt: 'Agent-assisted canvas editing and Studio multi-track refinement',
      },
      'zh-CN': {
        title: '进 Studio 精调多轨 / 导出 MP4',
        desc: '随时改文字、调轨道偏移或扩多尺寸，不用整片重抽',
        prompt: `参考「Jitter Superagents 产品能力展示」生成可编辑 Studio 多轨工程，把对话需求直接映射到画布变化并分别导出横竖版 MP4。`,
        alt: '对话驱动画布与 Studio 多轨精调',
      },
    },
  },
];

export const mcpShowcaseModules: readonly McpShowcaseModule[] = [
  {
    id: 'band-ecom',
    title: {
      en: 'High-converting product & AI launch films',
      'zh-CN': '高出片产品与 AI 功能发布片',
    },
    models: [
      { label: 'GPT Image 2.6', icon: modelIcon('providers/openai.svg') },
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
      {
        id: 'launch-figma-motion',
        image: TEMPLATE_MEDIA.figmaMotion.cover,
        video: TEMPLATE_MEDIA.figmaMotion.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.figmaMotion.id,
          title: TEMPLATE_MEDIA.figmaMotion.title,
          posterUrl: TEMPLATE_MEDIA.figmaMotion.cover,
          previewUrl: TEMPLATE_MEDIA.figmaMotion.preview,
        },
        content: {
          en: {
            tabLabel: 'Figma Motion',
            title: 'Config 2026 · Synchronized UI & timeline launch',
            prompt: `Use template "Config 2026 · Figma Motion" to craft our feature release video: sync playhead motion with UI state changes across desktop and mobile frames, and deliver HTML + MP4.`,
          },
          'zh-CN': {
            tabLabel: 'Figma Motion',
            title: 'Config 2026 · 时间线同步功能发布片',
            prompt: `使用模板「Config 2026 发布 Figma Motion」制作新品功能发布视频：保留时间线播放头与界面对象状态的同步联动，替换为我们的功能卡片与标题，交付 HTML 和 MP4。`,
          },
        },
      },
      {
        id: 'launch-aesthetics',
        image: TEMPLATE_MEDIA.aesthetics.cover,
        video: TEMPLATE_MEDIA.aesthetics.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.aesthetics.id,
          title: TEMPLATE_MEDIA.aesthetics.title,
          posterUrl: TEMPLATE_MEDIA.aesthetics.cover,
          previewUrl: TEMPLATE_MEDIA.aesthetics.preview,
        },
        content: {
          en: {
            tabLabel: 'Aesthetics',
            title: 'Aesthetics · 3D craft & interactive design reveal',
            prompt: `Adapt template "Aesthetics" for our design-tool launch: open with sculptural 3D visual tension, then transition smoothly into live product interactions and deliver HTML + MP4.`,
          },
          'zh-CN': {
            tabLabel: 'Aesthetics',
            title: 'Aesthetics · 3D 审美张力与交互揭示片',
            prompt: `使用模板「Aesthetics」制作产品发布短片：前段用高质感 3D 视觉与多维度排版建立审美期待，后段自然切入真实操作演示，交付 HTML 和 MP4。`,
          },
        },
      },
      {
        id: 'launch-framer-3',
        image: TEMPLATE_MEDIA.framer3.cover,
        video: TEMPLATE_MEDIA.framer3.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.framer3.id,
          title: TEMPLATE_MEDIA.framer3.title,
          posterUrl: TEMPLATE_MEDIA.framer3.cover,
          previewUrl: TEMPLATE_MEDIA.framer3.preview,
        },
        content: {
          en: {
            tabLabel: 'Framer 3.0',
            title: 'Framer 3.0 · Blue-light glass brand & release film',
            prompt: `Use template "Framer 3.0 Brand & Product Launch": lead with blue light streaks into branching and publish actions, showcase real edits mid-film, and close on abstract glass brand icons.`,
          },
          'zh-CN': {
            tabLabel: 'Framer 3.0',
            title: 'Framer 3.0 · 蓝光串联品牌与产品发布',
            prompt: `使用模板「Framer 3.0 品牌与产品发布」：开场以蓝色光线引出核心操作，中段展示具体编辑结果，后段抽象为玻璃材质品牌符号并导出 1080p MP4。`,
          },
        },
      },
    ],
  },
  {
    id: 'band-alpha',
    anchorId: 'band-3d',
    title: {
      en: 'Proven Skills: explainers & designer-grade polish',
      'zh-CN': '高转化动效 Skill：讲解、去 AI 味与手工质感',
    },
    models: [
      { label: 'Flux', icon: modelIcon('providers/models/flux.svg') },
      { label: 'Wan 2.7', icon: modelIcon('providers/models/alibaba-color.svg') },
      { label: 'ElevenLabs', icon: modelIcon('providers/models/elevenlabs.svg') },
    ],
    slides: [
      {
        id: 'skill-motionmaxxing',
        image: motionmaxxingMedia.poster,
        video: motionmaxxingMedia.video,
        target: { kind: 'skill', skillId: 'motionmaxxing' },
        content: {
          en: {
            tabLabel: 'Remove AI look',
            title: 'Turn templated AI motion into designer-grade films',
            prompt: 'Read OpenMotion Skill motionmaxxing (openmotion_get_skill) and run its anti-slop review on our 15-second launch film: eliminate slide cards and fake glow, rebuild kinetic typography with crisp easing and export MP4.',
          },
          'zh-CN': {
            tabLabel: '去掉 AI 味',
            title: '告别廉价模板感，做出设计师级动效成片',
            prompt: '读取 OpenMotion Skill「去掉动效的 AI 味」（motionmaxxing），去掉简陋文字卡、廉价渐变与假发光，按设计师级字体层级和缓动曲线重制 15 秒发布片并导出 MP4。',
          },
        },
      },
      {
        id: 'skill-faceless',
        image: facelessMedia.poster,
        video: facelessMedia.video,
        target: { kind: 'skill', skillId: 'higgsfield-faceless-video' },
        content: {
          en: {
            tabLabel: 'Faceless explainer',
            title: 'Narrated story & explainer films with zero filming',
            prompt: 'Use OpenMotion Skill "Faceless explainer" (higgsfield-faceless-video) to turn our product story into a 30-second illustrated chronicle with expressive voiceover, cut-paper captions and an editable Studio timeline.',
          },
          'zh-CN': {
            tabLabel: '无出镜讲解',
            title: '无需真人出镜，直出电影感水彩叙事讲解片',
            prompt: '使用 OpenMotion Skill「无出镜讲解视频」（higgsfield-faceless-video），把这段科普故事做成 30 秒水彩插画叙事短片，配情绪旁白与手写纸条字幕并保存可编辑工程。',
          },
        },
      },
      {
        id: 'skill-paper-collage',
        image: paperCollageMedia.poster,
        video: paperCollageMedia.video,
        target: { kind: 'skill', skillId: 'openmotion-paper-collage-explainer' },
        content: {
          en: {
            tabLabel: 'Paper collage',
            title: 'Torn-paper collage explainers built on the beat',
            prompt: 'Follow OpenMotion Skill openmotion-paper-collage-explainer: build a 20-second narrated explainer where textured torn-paper cutouts drop in on each narration beat with tactile drop shadows.',
          },
          'zh-CN': {
            tabLabel: '剪纸拼贴讲解',
            title: '手撕纸拼贴科普短片，画面随旁白节拍落位',
            prompt: '读取 OpenMotion Skill「剪纸拼贴讲解」（openmotion-paper-collage-explainer），把我们的行业原理解说做成 20 秒半色调网点剪纸拼贴短片，关键元素随旁白节拍逐层落位。',
          },
        },
      },
    ],
  },
  {
    id: 'band-recreate',
    title: {
      en: 'Brand visuals, 3D marks & official Brand Kits',
      'zh-CN': '品牌视觉大片与官方 Brand Kit 规范',
    },
    models: [
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Google Veo', icon: modelIcon('providers/models/google-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
      {
        id: 'brand-qwen-mark',
        image: TEMPLATE_MEDIA.qwenMark.cover,
        video: TEMPLATE_MEDIA.qwenMark.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.qwenMark.id,
          title: TEMPLATE_MEDIA.qwenMark.title,
          posterUrl: TEMPLATE_MEDIA.qwenMark.cover,
          previewUrl: TEMPLATE_MEDIA.qwenMark.preview,
        },
        content: {
          en: {
            tabLabel: '3D material mark',
            title: 'Qwen3.8-Max · Material-shifting 3D logo announcement',
            prompt: `Use template "Qwen3.8-Max": morph our brand emblem across glass and metallic materials, then shift it cleanly to reveal our model release headline and specs.`,
          },
          'zh-CN': {
            tabLabel: '材质标志公告',
            title: 'Qwen3.8-Max · 3D 玻璃材质标志与模型公告',
            prompt: `使用模板「Qwen3.8-Max 材质标志与模型公告」：保持主标志轮廓不变，先切换多层折射材质，再平滑移位让出空间展示新模型名称与核心参数。`,
          },
        },
      },
      {
        id: 'brand-cyera-labs',
        image: TEMPLATE_MEDIA.cyeraBrand.cover,
        video: TEMPLATE_MEDIA.cyeraBrand.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.cyeraBrand.id,
          title: TEMPLATE_MEDIA.cyeraBrand.title,
          posterUrl: TEMPLATE_MEDIA.cyeraBrand.cover,
          previewUrl: TEMPLATE_MEDIA.cyeraBrand.preview,
        },
        content: {
          en: {
            tabLabel: 'Brand typography',
            title: 'Cyera Research Labs · Bold brand system & 3D motif',
            prompt: `Adapt template "Cyera Research Labs": build from our logo geometry, colour tokens and display typography into full webpage and brand statement shots.`,
          },
          'zh-CN': {
            tabLabel: '品牌字形视觉',
            title: 'Cyera Research Labs · 标志字形与高反差品牌片',
            prompt: `使用模板「Cyera Research Labs」：从标志、配色与大号字形构造切入，把网页与品牌核心主张用统一 3D 视觉线索串成 30 秒大片。`,
          },
        },
      },
      {
        id: 'brand-bento-kit',
        image: brandCatalogFile('bento', 'cover'),
        showcaseIframe: brandCatalogFile('bento', 'showcase'),
        target: {
          kind: 'brand-kit',
          brandKitId: 'bento',
          showcaseUrl: brandCatalogFile('bento', 'showcase'),
        },
        content: {
          en: {
            tabLabel: 'Bento Brand Kit',
            title: 'Apply style-first Brand Kits without brand lock-in',
            prompt: 'Import the official OpenMotion Brand Kit "Bento" (bento) as a style-only Motion Package, reuse its grid spacing, typography and colour tokens for our 20-second product overview, and export MP4.',
          },
          'zh-CN': {
            tabLabel: 'Bento 品牌包',
            title: '套用官方 Bento 版式风格包，不绑定特定大牌也能高出片',
            prompt: '导入 OpenMotion 官方品牌包「Bento」（bento）作为纯视觉规范包，复用其网格卡片、字体层级与配色系统生成 20 秒产品总览视频，保留可编辑工程并导出 MP4。',
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
