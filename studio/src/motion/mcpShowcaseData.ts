import { brandCatalogFile } from '../../../shared/brand-catalog';
import { designSystemAsset } from '../../../packages/design-system/index.js';
import facelessExplainerPoster from './mcp-gallery/faceless_explainer.webp';
import studioEditingPoster from './mcp-gallery/studio-editing.jpg';
import studioEditingVideo from './mcp-gallery/studio-editing.mp4';
import templateBriefPoster from './mcp-gallery/template-brief.jpg';
import templateBriefVideo from './mcp-gallery/template-brief.mp4';
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
  loop?: boolean;
  fit?: 'contain';
  target?: McpCaseTarget;
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

// Template IDs and preview media come from library/templates/catalog.
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
  harvey: {
    id: 'motion-4cab572a-4d2a-4058-8a06-84cf3fda0df0',
    title: 'Harvey II',
    cover: 'https://r.open-design.ai/files/23231f47e0177329b0152659525c9bcb3099ddefd11438156fa5f00847a15a4f',
    preview: 'https://r.open-design.ai/files/45576b4354fd8dba80ddb104981486033fc63cc07fa7785400517e85394d6483',
  },
  noCode: {
    id: 'motion-b31d078a-4e5e-461e-8b43-3101ee0a2f93',
    title: 'A New Era of No-Code',
    cover: 'https://r.open-design.ai/files/8204962a0db13d83cdb66f20df40b4ee61a8cdd283de7dec57b0f2abee574b88',
    preview: 'https://r.open-design.ai/files/91203186458d57604f8cdab7d3d1c89a94286a6e5e7c487833a6436b3044ded5',
  },
  universe: {
    id: 'motion-343ccb64-5c8e-4101-b65e-463aec3a7c35',
    title: 'Universe 2023',
    cover: 'https://r.open-design.ai/files/220884d84985843a819a8d7cae22592302297d53c1d3bc887c835079e5b0d0e1',
    preview: 'https://r.open-design.ai/files/5c4806b28d5c8cc81b1bd85599fecf12880a513343a37adf23672c0a93e43f06',
  },
  creativeCloud: {
    id: 'motion-e62d4e85-ccf4-4e3e-8388-ae70143cb3dc',
    title: 'Creative Cloud',
    cover: 'https://r.open-design.ai/files/7cf07198ff160c188ee738515c412f6ab2da13333168ec3aed2ec09170f4a797',
    preview: 'https://r.open-design.ai/files/e8d62e79d54c2c12b002b0556fa67380064055e76faa16b6966eb9877a3b1c4b',
  },
} as const;

const productShowcaseMedia = skillMedia('higgsfield-product-photoshoot');
const facelessMedia = skillMedia('higgsfield-faceless-video', facelessExplainerPoster);
const splashMedia = skillMedia('openmotion-juicy-splash-poster');
const inkRibbonMedia = skillMedia('openmotion-ink-ribbon');

export const mcpHeroBeats: readonly McpHeroBeat[] = [
  {
    id: 'brief',
    num: '01',
    image: templateBriefPoster,
    video: templateBriefVideo,
    loop: false,
    target: {
      kind: 'template',
      templateId: TEMPLATE_MEDIA.figmaMotion.id,
      title: TEMPLATE_MEDIA.figmaMotion.title,
      posterUrl: TEMPLATE_MEDIA.figmaMotion.cover,
      previewUrl: TEMPLATE_MEDIA.figmaMotion.preview,
    },
    content: {
      en: {
        title: 'Choose a template and write your brief',
        desc: 'Give your Agent the feature to show and the screens to use.',
        prompt: 'Use "Config 2026 · Figma Motion" as a reference for a 20-second launch video about our new timeline. Use the two product screenshots I provided to show keyframes and easing, and deliver an editable project and MP4.',
        alt: 'Selecting the Figma Motion template and writing a product launch brief',
      },
      'zh-CN': {
        title: '选模板，写创作需求',
        desc: '告诉 Agent 要讲哪个功能、用哪些产品截图。',
        prompt: '参考「Config 2026 发布 Figma Motion」，为新版时间轴制作一支 20 秒功能发布片。用我提供的两张界面截图演示关键帧和缓动，交付可编辑工程和 MP4。',
        alt: '选择 Figma Motion 模板并撰写功能发布片的创作需求',
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
        title: 'Turn the brief into a storyboard',
        desc: 'Plan the opening, product demo and end card, then connect the shots.',
        prompt: `Adapt "Framer 3.0 Brand & Product Launch" for our v3 release: keep the blue glass lighting transitions, insert our product screens and export 1080p MP4.`,
        alt: 'Framer 3.0 brand and product launch film',
      },
      'zh-CN': {
        title: '把需求拆成分镜',
        desc: '排好开场、产品演示和收尾，再把镜头接起来。',
        prompt: `基于「Framer 3.0 品牌与产品发布」生成我们的新版本发布短片，保留蓝色光影与玻璃符号转场，替换成我方界面并导出 1080p MP4。`,
        alt: 'Framer 3.0 品牌与产品发布短片',
      },
    },
  },
  {
    id: 'product-shots',
    num: '03',
    image: productShowcaseMedia.poster,
    video: productShowcaseMedia.video,
    loop: false,
    fit: 'contain',
    target: { kind: 'skill', skillId: 'higgsfield-product-photoshoot' },
    content: {
      en: {
        title: 'Add product shots with a Skill',
        desc: 'Add a studio shot, a lifestyle shot and a hero shot to the cut.',
        prompt: 'Use the "Product showcase reel" Skill with my product images to create a studio shot, a lifestyle shot and a hero shot. Keep the packaging and lettering consistent, then add the shots to my current OpenMotion project.',
        alt: 'BIOJUSS product showcase reel',
      },
      'zh-CN': {
        title: '用 Skill 补产品镜头',
        desc: '给粗剪补上棚拍、使用场景和主视觉镜头。',
        prompt: '用「产品展示短片」Skill，根据我提供的产品图做棚拍、使用场景和主视觉镜头。保持包装和字样一致，再把镜头加进我当前的 OpenMotion 工程。',
        alt: 'BIOJUSS 产品展示短片',
      },
    },
  },
  {
    id: 'studio',
    num: '04',
    image: studioEditingPoster,
    video: studioEditingVideo,
    loop: false,
    content: {
      en: {
        title: 'Fine-tune in Studio and export',
        desc: 'Adjust text and track timing, then export landscape and portrait versions.',
        prompt: 'Read my current OpenMotion project and version. Confirm the text and timing edits with me, then make editable 16:9 and 9:16 versions while preserving the original. Review both in Studio before exporting MP4.',
        alt: 'OpenMotion Studio composition preview and timeline',
      },
      'zh-CN': {
        title: '在 Studio 微调并导出',
        desc: '改文字、调轨道时序，分别导出横版和竖版。',
        prompt: '读取我当前的 OpenMotion 工程和版本。和我确认文字与轨道时序的修改后，保留原工程，另做 16:9 和 9:16 两份可编辑版本。在 Studio 预览确认后，分别导出 MP4。',
        alt: 'OpenMotion Studio 的成片预览和时间轴',
      },
    },
  },
];

export const mcpShowcaseModules: readonly McpShowcaseModule[] = [
  {
    id: 'band-ecom',
    title: {
      en: 'Product launch films',
      'zh-CN': '产品发布片',
    },
    models: [
      { label: 'GPT Image 2.6', icon: modelIcon('providers/openai.svg') },
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
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
        id: 'launch-harvey',
        image: TEMPLATE_MEDIA.harvey.cover,
        video: TEMPLATE_MEDIA.harvey.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.harvey.id,
          title: TEMPLATE_MEDIA.harvey.title,
          posterUrl: TEMPLATE_MEDIA.harvey.cover,
          previewUrl: TEMPLATE_MEDIA.harvey.preview,
        },
        content: {
          en: {
            tabLabel: 'Harvey II',
            title: 'Harvey II · Paper collage meets product UI',
            prompt: `Adapt the "Harvey II" template: use textured paper, circles and cutouts to introduce our product, then connect those shapes to real screens for projects, tasks and resources.`,
          },
          'zh-CN': {
            tabLabel: 'Harvey II',
            title: 'Harvey II · 纸面拼贴与产品界面',
            prompt: `用「Harvey II」模板做发布片。先用纸张纹理、圆形与镂空拼贴引入，再把这些图形接到我们的项目、任务和资源界面。`,
          },
        },
      },
      {
        id: 'launch-no-code',
        image: TEMPLATE_MEDIA.noCode.cover,
        video: TEMPLATE_MEDIA.noCode.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.noCode.id,
          title: TEMPLATE_MEDIA.noCode.title,
          posterUrl: TEMPLATE_MEDIA.noCode.cover,
          previewUrl: TEMPLATE_MEDIA.noCode.preview,
        },
        content: {
          en: {
            tabLabel: 'No-Code',
            title: 'A New Era of No-Code · A journey through layered screens',
            prompt: `Use "A New Era of No-Code" as a template: let one moving sphere guide the viewer through our layered pages, forms and workflow screens, then reveal the finished site.`,
          },
          'zh-CN': {
            tabLabel: 'No-Code',
            title: 'A New Era of No-Code · 穿行于多层界面',
            prompt: `用「A New Era of No-Code」模板，让一颗球穿过我们的网页、表单和工作流界面，最后拉开镜头展示完成的网站。`,
          },
        },
      },
    ],
  },
  {
    id: 'band-alpha',
    anchorId: 'band-3d',
    title: {
      en: 'Motion Skills for ads, workflows and explainers',
      'zh-CN': '动效 Skill：广告、流程与讲解',
    },
    models: [
      { label: 'Flux', icon: modelIcon('providers/models/flux.svg') },
      { label: 'Wan 2.7', icon: modelIcon('providers/models/alibaba-color.svg') },
      { label: 'ElevenLabs', icon: modelIcon('providers/models/elevenlabs.svg') },
    ],
    slides: [
      {
        id: 'skill-juicy-splash',
        image: splashMedia.poster,
        video: splashMedia.video,
        target: { kind: 'skill', skillId: 'openmotion-juicy-splash-poster' },
        content: {
          en: {
            tabLabel: 'Juicy Splash Poster',
            title: 'A fruit and liquid burst for a drink launch',
            prompt: `Use the Juicy Splash Poster Skill with our drink photo and flavour name. Keep the packaging readable as fruit and liquid burst around it, then hold on the final poster.`,
          },
          'zh-CN': {
            tabLabel: '夏日饮品冰爽海报',
            title: '用果片和水花做一支饮品广告',
            prompt: `用「夏日饮品冰爽海报」Skill，把我的饮料图和口味名做成动效海报。果片和液体从产品周围迸发，保持包装清晰，最后停在完整海报。`,
          },
        },
      },
      {
        id: 'skill-ink-ribbon',
        image: inkRibbonMedia.poster,
        video: inkRibbonMedia.video,
        target: { kind: 'skill', skillId: 'openmotion-ink-ribbon' },
        content: {
          en: {
            tabLabel: 'Ink Ribbon',
            title: 'One blue ribbon links every step of a workflow',
            prompt: `Use the Ink Ribbon Skill to explain our three-step workflow. Carry a glossy blue ribbon from the opening headline through each step icon and into the closing brand mark.`,
          },
          'zh-CN': {
            tabLabel: '产品流程一线串讲',
            title: '用一条蓝色丝带串起完整流程',
            prompt: `用「产品流程一线串讲」Skill 讲解我们的三步流程。让一条有光泽的蓝色丝带从开场标题穿过三个步骤图标，最后收成品牌标志。`,
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
    ],
  },
  {
    id: 'band-recreate',
    title: {
      en: 'Brand identity in motion',
      'zh-CN': '品牌标志与视觉系统',
    },
    models: [
      { label: 'Seedance 2.5', icon: modelIcon('providers/models/bytedance-color.svg') },
      { label: 'Google Veo', icon: modelIcon('providers/models/google-color.svg') },
      { label: 'Suno', icon: modelIcon('providers/models/suno.svg') },
    ],
    slides: [
      {
        id: 'brand-universe',
        image: TEMPLATE_MEDIA.universe.cover,
        video: TEMPLATE_MEDIA.universe.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.universe.id,
          title: TEMPLATE_MEDIA.universe.title,
          posterUrl: TEMPLATE_MEDIA.universe.cover,
          previewUrl: TEMPLATE_MEDIA.universe.preview,
        },
        content: {
          en: {
            tabLabel: 'Universe',
            title: 'Universe 2023 · A 3D world unfolds from one mark',
            prompt: `Adapt the Universe 2023 template for our event: start on our logo outline, open it into a world of playful 3D shapes in our brand colours, and gather them back into the event mark.`,
          },
          'zh-CN': {
            tabLabel: 'Universe',
            title: 'Universe 2023 · 从标志展开三维图形宇宙',
            prompt: `用「Universe 2023｜大会图形揭晓」模板做我们的活动片头。由标志轮廓展开品牌色三维图形，最后收回活动标志。`,
          },
        },
      },
      {
        id: 'brand-creative-cloud',
        image: TEMPLATE_MEDIA.creativeCloud.cover,
        video: TEMPLATE_MEDIA.creativeCloud.preview,
        target: {
          kind: 'template',
          templateId: TEMPLATE_MEDIA.creativeCloud.id,
          title: TEMPLATE_MEDIA.creativeCloud.title,
          posterUrl: TEMPLATE_MEDIA.creativeCloud.cover,
          previewUrl: TEMPLATE_MEDIA.creativeCloud.preview,
        },
        content: {
          en: {
            tabLabel: 'Creative Cloud',
            title: 'Creative Cloud · One outline across collage and illustration',
            prompt: `Use the Creative Cloud brand-film template to carry our logo outline through interface, collage and illustration. Keep the silhouette recognizable as the materials change.`,
          },
          'zh-CN': {
            tabLabel: 'Creative Cloud',
            title: 'Creative Cloud · 同一标志穿过拼贴与插画',
            prompt: `用「Creative Cloud｜标志主片」模板，把我们的标志轮廓带过界面、拼贴和插画。每次换材质时保留可辨认的外形。`,
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
