import { entry as gleanAgentsTemplate } from '../../../library/templates/catalog/motion-f6f244d1-c549-4081-8a5d-f0e1e3660044/template.json';
import { entry as claudeAgentViewTemplate } from '../../../library/templates/catalog/motion-89f2191f-bd58-48e2-a1f5-41c0cc759b59/template.json';
import { entry as polymarketPerpsTemplate } from '../../../library/templates/catalog/motion-b09ce21c-bdd4-4bf7-8d22-bb19fd40e5ab/template.json';
import { entry as boltForgeTemplate } from '../../../library/templates/catalog/motion-8605acf7-c0e9-465b-858a-114c49764c3d/template.json';
import { entry as openaiMathTemplate } from '../../../library/templates/catalog/motion-10adc0e0-3f63-45c9-9389-2657360c8aa0/template.json';
import { entry as linearOrbitTemplate } from '../../../library/templates/catalog/motion-3b955ba8-2f6f-47ef-910c-79115843bd6b/template.json';
import { entry as tidalManifestoTemplate } from '../../../library/templates/catalog/motion-cfd6f6b6-2f3f-4e53-957d-1e87cfebe777/template.json';
import { brandCatalogFile } from '../../../shared/brand-catalog';
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
  content: { title: string; prompt: string };
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
    templateId: gleanAgentsTemplate.templateId,
    image: gleanAgentsTemplate.coverUrl,
    video: gleanAgentsTemplate.previewUrl,
    content: {
      title: 'Glean Agents · Enterprise workflow launch',
      prompt: '@OpenDesign Adapt template "Glean Agents Launch" to expand one input box into our connected cross-team workflows and deliver HTML + MP4.',
    },
  },
  {
    id: 'claude-agent-view',
    category: 'launch',
    kind: 'template',
    duration: '0:39',
    templateId: claudeAgentViewTemplate.templateId,
    image: claudeAgentViewTemplate.coverUrl,
    video: claudeAgentViewTemplate.previewUrl,
    content: {
      title: 'Claude Code · Agent View release',
      prompt: '@OpenDesign Use template "Claude Code · Agent View" to pull scattered developer terminals into one clean multi-agent workspace and export MP4.',
    },
  },
  {
    id: 'polymarket-perps',
    category: 'launch',
    kind: 'template',
    duration: '0:37',
    templateId: polymarketPerpsTemplate.templateId,
    image: polymarketPerpsTemplate.coverUrl,
    video: polymarketPerpsTemplate.previewUrl,
    content: {
      title: 'Polymarket Perps · Dark terminal demo',
      prompt: '@OpenDesign Use template "Perps Launch" to push smoothly from our full dashboard into the action form, stepping through each control before submission.',
    },
  },
  {
    id: 'bolt-forge',
    category: 'launch',
    kind: 'template',
    duration: '0:37',
    templateId: boltForgeTemplate.templateId,
    image: boltForgeTemplate.coverUrl,
    video: boltForgeTemplate.previewUrl,
    content: {
      title: 'Bolt Forge · Prompt-to-website launch',
      prompt: '@OpenDesign Adapt template "Bolt Forge Launch": show the typed prompt first, scroll through our live site result, then unfold multiple outputs into a spatial mosaic.',
    },
  },
  {
    id: 'openai-math',
    category: 'brand',
    kind: 'template',
    duration: '0:32',
    templateId: openaiMathTemplate.templateId,
    image: openaiMathTemplate.coverUrl,
    video: openaiMathTemplate.previewUrl,
    content: {
      title: 'OpenAI · Research breakthrough geometry',
      prompt: '@OpenDesign Use template "Research Breakthrough" to visualize three technical milestones as evolving chalkboard geometry and deliver HTML + MP4.',
    },
  },
  {
    id: 'linear-orbit',
    category: 'brand',
    kind: 'template',
    duration: '0:29',
    templateId: linearOrbitTemplate.templateId,
    image: linearOrbitTemplate.coverUrl,
    video: linearOrbitTemplate.previewUrl,
    content: {
      title: 'Linear · Orbit event teaser',
      prompt: '@OpenDesign Adapt template "Linear · Orbit": pull back from macro letterform geometry into our event title, blur it softly, and reveal our launch date and URL.',
    },
  },
  {
    id: 'tidal-manifesto',
    category: 'brand',
    kind: 'template',
    duration: '0:15',
    templateId: tidalManifestoTemplate.templateId,
    image: tidalManifestoTemplate.coverUrl,
    video: tidalManifestoTemplate.previewUrl,
    content: {
      title: 'TIDAL · 15-second kinetic manifesto',
      prompt: '@OpenDesign Use template "TIDAL Kinetic Manifesto 15s" to pace our five brand statements into crisp high-contrast kinetic typography and export MP4.',
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
      title: 'Design style library (21 visual rules)',
      prompt: '@OpenDesign Read OpenMotion Skill openmotion-design-styles (openmotion_get_skill) and build a 15-second launch video following Swiss or Memphis design rules with real typography and motion grammar.',
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
      title: 'Cut-paper how-it-works explainer',
      prompt: '@OpenDesign Read OpenMotion Skill openmotion-paper-stop-motion (openmotion_get_skill) to turn our product mechanism into a tactile cut-paper stop-motion explainer with sticky-note steps and red marker callouts.',
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
      title: 'Edit talking-head like a reference',
      prompt: '@OpenDesign Read OpenMotion Skill openmotion-talking-head-recreation (openmotion_get_skill): map the reference video’s cut rhythm, punch-ins, captions and text cards onto my raw talking-head footage in Studio.',
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
      title: 'Apple official Brand Kit',
      prompt: '@OpenDesign Import the official OpenMotion Brand Kit "Apple" (apple) as a style-only Motion Package, apply its typography, spacing and colour tokens to our hardware reveal, and deliver an editable Studio project.',
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
      title: 'Clean minimal layout Brand Kit',
      prompt: '@OpenDesign Import the official OpenMotion Brand Kit "Clean" (clean) as a style-only Motion Package to style our SaaS walkthrough with crisp hierarchy and modern minimal motion, then export 1080p MP4.',
    },
  },
];
