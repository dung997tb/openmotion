import { brandCatalogFile } from '../../../shared/brand-catalog';
import type { LocalizedPair } from './mcpShowcaseData';
import { motionSkills } from './skillCatalog';

export const mcpGalleryCategories = [
  ['all', 'All'],
  ['launch', 'Product & AI launches'],
  ['brand', 'Brand & visual motion'],
  ['skills', 'Top Skills'],
  ['brandkit', 'Official Brand Kits'],
] as const;

export type McpGalleryCategory = (typeof mcpGalleryCategories)[number][0];

export type McpGalleryPosition = { category: McpGalleryCategory; cardId: string };

export function readMcpGalleryPosition(): McpGalleryPosition | null {
  const position = history.state?.openmotionMcpGalleryPosition as McpGalleryPosition | undefined;
  if (!position) return null;
  const card = mcpGalleryCards.find(item => item.id === position.cardId);
  return card && (position.category === 'all' || position.category === card.category) ? position : null;
}

export function recordMcpGalleryPosition(position: McpGalleryPosition) {
  // Attach the return point to this history entry without changing its route or router state.
  history.replaceState({ ...history.state, openmotionMcpGalleryPosition: position }, '');
}

export type McpGalleryCard = {
  id: string;
  category: Exclude<McpGalleryCategory, 'all'>;
  kind: 'template' | 'skill' | 'brand-kit';
  duration?: string;
  image: string;
  video?: string;
  showcaseIframe?: string;
  templateId?: string;
  skillId?: string;
  brandKitId?: string;
  content: LocalizedPair<{ title: string; prompt: string }>;
};

function skillAsset(id: string) {
  const skill = motionSkills.find(item => item.id === id);
  return { image: skill?.cover?.poster ?? '', video: skill?.cover?.video };
}

const designStylesMedia = skillAsset('openmotion-design-styles');
const paperStopMedia = skillAsset('openmotion-paper-stop-motion');
const talkingHeadRecMedia = skillAsset('openmotion-talking-head-recreation');

export const mcpGalleryCards: readonly McpGalleryCard[] = [
  {
    id: 'glean-agents',
    category: 'launch',
    kind: 'template',
    duration: '1:01',
    templateId: 'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044',
    image: 'https://r.open-design.ai/files/854aa66fd5000057c47ce3be26090044e3bca870c81cc3b0534a77424937a135',
    video: 'https://r.open-design.ai/files/82cada1c091bda4b6e5d82284dc956df7857acaabaff600ccad14854a4b53361',
    content: {
      en: {
        title: 'Glean Agents · Enterprise workflow launch',
        prompt: '@OpenDesign Adapt template "Glean Agents Launch" to expand one input box into our connected cross-team workflows and deliver HTML + MP4.',
      },
      'zh-CN': {
        title: 'Glean Agents · 跨部门工作流发布',
        prompt: '@OpenDesign 使用模板「Glean Agents 发布」，从一个输入框展开到我们的多部门连线工作流并回到清晰结果界面，交付 HTML 和 MP4。',
      },
    },
  },
  {
    id: 'claude-agent-view',
    category: 'launch',
    kind: 'template',
    duration: '0:39',
    templateId: 'motion-89f2191f-bd58-48e2-a1f5-41c0cc759b59',
    image: 'https://r.open-design.ai/files/b6402df78d528a015dceb8d06ae0a8e1096da966e4d0c59fc98d241a01b0ec29',
    video: 'https://r.open-design.ai/files/024230860794d2e9a1b3de3d3ca7c26b99097128a151f3248885c46f1c72631c',
    content: {
      en: {
        title: 'Claude Code · Agent View release',
        prompt: '@OpenDesign Use template "Claude Code · Agent View" to pull scattered developer terminals into one clean multi-agent workspace and export MP4.',
      },
      'zh-CN': {
        title: 'Claude Code · Agent View 多任务发布',
        prompt: '@OpenDesign 使用模板「Claude Code｜Agent View」，用角色牵引散落终端收拢到统一视图，替换成我们的产品文案并交付 HTML 与 MP4。',
      },
    },
  },
  {
    id: 'polymarket-perps',
    category: 'launch',
    kind: 'template',
    duration: '0:37',
    templateId: 'motion-b09ce21c-bdd4-4bf7-8d22-bb19fd40e5ab',
    image: 'https://r.open-design.ai/files/53383c85ec4f17ce01ec2d99b69c64f66edeec6eb56764522388b815811e0466',
    video: 'https://r.open-design.ai/files/6d16a00119d8ffd9d98c6e94b90769ea44f0b00b30495bfecccc9f9a171981f4',
    content: {
      en: {
        title: 'Polymarket Perps · Dark terminal demo',
        prompt: '@OpenDesign Use template "Perps Launch" to push smoothly from our full dashboard into the action form, stepping through each control before submission.',
      },
      'zh-CN': {
        title: 'Polymarket Perps · 暗调终端产品演示',
        prompt: '@OpenDesign 使用模板「Perps 上线」，从全局控制台推近到核心操作表单，分步演示关键交互后提交，交付 HTML 和 MP4。',
      },
    },
  },
  {
    id: 'bolt-forge',
    category: 'launch',
    kind: 'template',
    duration: '0:37',
    templateId: 'motion-8605acf7-c0e9-465b-858a-114c49764c3d',
    image: 'https://r.open-design.ai/files/4ae59223be289e50d0b37c5d1dd57fb298b002545979ebe25abecfafe3b65197',
    video: 'https://r.open-design.ai/files/4564758acd84fd2f95e35213799473c4811bead609a4ba11f846cd580c561beb',
    content: {
      en: {
        title: 'Bolt Forge · Prompt-to-website launch',
        prompt: '@OpenDesign Adapt template "Bolt Forge Launch": show the typed prompt first, scroll through our live site result, then unfold multiple outputs into a spatial mosaic.',
      },
      'zh-CN': {
        title: 'Bolt Forge · 提示词到网站发布短片',
        prompt: '@OpenDesign 使用模板「Bolt Forge｜产品发布」，先完整呈现输入提示词，再切入可滚动页面结果并展开多作品空间拼图，交付 HTML 与 MP4。',
      },
    },
  },
  {
    id: 'openai-math',
    category: 'brand',
    kind: 'template',
    duration: '0:32',
    templateId: 'motion-10adc0e0-3f63-45c9-9389-2657360c8aa0',
    image: 'https://r.open-design.ai/files/c32d07c5b4a4d1ca5618cf32d3425f44081a72af3c0db4eac03882155242c29c',
    video: 'https://r.open-design.ai/files/56a8ccd856a2d879496863e996b372d8d909a6b1e8b7f431694f17699642fd18',
    content: {
      en: {
        title: 'OpenAI · Research breakthrough geometry',
        prompt: '@OpenDesign Use template "Research Breakthrough" to visualize three technical milestones as evolving chalkboard geometry and deliver HTML + MP4.',
      },
      'zh-CN': {
        title: 'OpenAI · 数学与研究突破几何动效',
        prompt: '@OpenDesign 使用模板「研究突破｜数学与理论计算机科学成果」，用暗黑手绘几何图形演绎 3 项技术里程碑的演化衔接，交付 HTML 与 MP4。',
      },
    },
  },
  {
    id: 'linear-orbit',
    category: 'brand',
    kind: 'template',
    duration: '0:29',
    templateId: 'motion-3b955ba8-2f6f-47ef-910c-79115843bd6b',
    image: 'https://r.open-design.ai/files/068801f785361589c8693990803e86da1f62d44154031e7e9184811c0401fdb8',
    video: 'https://r.open-design.ai/files/ef2408d56e114cdde9ccd81e7e3e6c021a22fbe7ccd2faa586c94d32558788cb',
    content: {
      en: {
        title: 'Linear · Orbit event teaser',
        prompt: '@OpenDesign Adapt template "Linear · Orbit": pull back from macro letterform geometry into our event title, blur it softly, and reveal our launch date and URL.',
      },
      'zh-CN': {
        title: 'Linear · Orbit 大会预告片头',
        prompt: '@OpenDesign 使用模板「Orbit｜大会预告」，从极简字形构造特写拉开到主标题，虚化背景后呈现我们的活动日期与网址，交付 HTML 和 MP4。',
      },
    },
  },
  {
    id: 'tidal-manifesto',
    category: 'brand',
    kind: 'template',
    duration: '0:15',
    templateId: 'motion-cfd6f6b6-2f3f-4e53-957d-1e87cfebe777',
    image: 'https://r.open-design.ai/files/b187a1087ba7244e4b1c7c967ecbd0c640480e88ee8cfeeaaaa8b569bbfc0571',
    video: 'https://r.open-design.ai/files/c9eedb6b83b863b2e7c9efd7dd4139831271a32fe98e15cd1ac5e186ec90f614',
    content: {
      en: {
        title: 'TIDAL · 15-second kinetic manifesto',
        prompt: '@OpenDesign Use template "TIDAL Kinetic Manifesto 15s" to pace our five brand statements into crisp high-contrast kinetic typography and export MP4.',
      },
      'zh-CN': {
        title: 'TIDAL · 15 秒高反差文字主视觉',
        prompt: '@OpenDesign 使用模板「TIDAL｜文字主视觉 15 秒版」，在 15 秒内用 5 组强节奏大字卡片表达品牌主张，每次只聚焦一组关键词，交付 MP4。',
      },
    },
  },
  {
    id: 'design-styles',
    category: 'skills',
    kind: 'skill',
    duration: '0:15',
    skillId: 'openmotion-design-styles',
    image: designStylesMedia.image,
    video: designStylesMedia.video,
    content: {
      en: {
        title: 'Design style library (21 visual rules)',
        prompt: '@OpenDesign Read OpenMotion Skill openmotion-design-styles (openmotion_get_skill) and build a 15-second launch video following Swiss or Memphis design rules with real typography and motion grammar.',
      },
      'zh-CN': {
        title: '设计风格库（21 套视觉规则）',
        prompt: '@OpenDesign 读取 OpenMotion Skill「设计风格库」（openmotion-design-styles），选择包豪斯、瑞士国际或孟菲斯风格规则制作 15 秒品牌宣传片，严格套用对应配色与运动语法。',
      },
    },
  },
  {
    id: 'paper-stop-motion',
    category: 'skills',
    kind: 'skill',
    duration: '0:18',
    skillId: 'openmotion-paper-stop-motion',
    image: paperStopMedia.image,
    video: paperStopMedia.video,
    content: {
      en: {
        title: 'Cut-paper how-it-works explainer',
        prompt: '@OpenDesign Read OpenMotion Skill openmotion-paper-stop-motion (openmotion_get_skill) to turn our product mechanism into a tactile cut-paper stop-motion explainer with sticky-note steps and red marker callouts.',
      },
      'zh-CN': {
        title: '纸艺原理讲解定格短片',
        prompt: '@OpenDesign 读取 OpenMotion Skill「纸艺原理讲解」（openmotion-paper-stop-motion），把产品工作原理做成手工剪纸定格科普短片，配便签分步卡片与红笔圈注，导出可编辑工程。',
      },
    },
  },
  {
    id: 'talking-head-recreation',
    category: 'skills',
    kind: 'skill',
    duration: '0:25',
    skillId: 'openmotion-talking-head-recreation',
    image: talkingHeadRecMedia.image,
    video: talkingHeadRecMedia.video,
    content: {
      en: {
        title: 'Edit talking-head like a reference',
        prompt: '@OpenDesign Read OpenMotion Skill openmotion-talking-head-recreation (openmotion_get_skill): map the reference video’s cut rhythm, punch-ins, captions and text cards onto my raw talking-head footage in Studio.',
      },
      'zh-CN': {
        title: '照参考片剪口播（1:1 节奏复刻）',
        prompt: '@OpenDesign 读取 OpenMotion Skill「照参考片剪口播」（openmotion-talking-head-recreation），拆解参考视频的切镜、推近、字幕样式与标题卡节奏，复刻到我的原始口播素材中并进 Studio 微调。',
      },
    },
  },
  {
    id: 'brandkit-apple',
    category: 'brandkit',
    kind: 'brand-kit',
    brandKitId: 'apple',
    image: brandCatalogFile('apple', 'cover'),
    showcaseIframe: brandCatalogFile('apple', 'showcase'),
    content: {
      en: {
        title: 'Apple official Brand Kit',
        prompt: '@OpenDesign Import the official OpenMotion Brand Kit "Apple" (apple) as a style-only Motion Package, apply its typography, spacing and colour tokens to our hardware reveal, and deliver an editable Studio project.',
      },
      'zh-CN': {
        title: 'Apple 官方品牌视觉包',
        prompt: '@OpenDesign 导入 OpenMotion 官方品牌包「Apple」（apple）作为纯样式规范包，套用其字体层级、留白比例与光洁色彩体系制作新品发布视频，保存可编辑工程并导出 MP4。',
      },
    },
  },
  {
    id: 'brandkit-clean',
    category: 'brandkit',
    kind: 'brand-kit',
    brandKitId: 'clean',
    image: brandCatalogFile('clean', 'cover'),
    showcaseIframe: brandCatalogFile('clean', 'showcase'),
    content: {
      en: {
        title: 'Clean minimal layout Brand Kit',
        prompt: '@OpenDesign Import the official OpenMotion Brand Kit "Clean" (clean) as a style-only Motion Package to style our SaaS walkthrough with crisp hierarchy and modern minimal motion, then export 1080p MP4.',
      },
      'zh-CN': {
        title: 'Clean 极简版式风格包',
        prompt: '@OpenDesign 导入 OpenMotion 官方品牌包「Clean」（clean）作为版式风格包，用现代极简字体与清爽留白包装我们的 SaaS 功能介绍短片，不锁定具体大牌，交付可编辑工程与 MP4。',
      },
    },
  },
];
