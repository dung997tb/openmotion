import type { StudioScene } from './studio-catalog.ts';
import type { DesignScenarioId } from './design-project.ts';

export const scenarioCategories = [
  { id: 'topic', label: 'Topics', icon: 'sparkling-line' },
  { id: 'campaign', label: 'Campaigns', icon: 'flashlight-line' },
  { id: 'role', label: 'Roles', icon: 'user-3-line' },
] as const;
export type ScenarioCategory = typeof scenarioCategories[number]['id'];

export const scenarioStepTypes = ['brief', 'web-page', 'image', 'video', 'audio', 'social-pack'] as const;
export type ScenarioStepType = typeof scenarioStepTypes[number];
export type PoolKind = 'image' | 'video' | 'audio' | 'page' | 'motion' | 'text';

export const socialPlatforms = [
  { id: 'x', label: 'X', maxChars: 280, maxHashtags: 2, aspect: '16:9' },
  { id: 'instagram', label: 'Instagram', maxChars: 2200, maxHashtags: 8, aspect: '4:5' },
  { id: 'tiktok', label: 'TikTok', maxChars: 2200, maxHashtags: 5, aspect: '9:16' },
  { id: 'douyin', label: 'Douyin', maxChars: 1000, maxHashtags: 5, aspect: '9:16' },
  { id: 'xiaohongshu', label: 'Xiaohongshu', maxChars: 1000, maxTitleChars: 20, maxHashtags: 10, aspect: '3:4' },
  { id: 'linkedin', label: 'LinkedIn', maxChars: 3000, maxHashtags: 3, aspect: '1:1' },
] as const;
export type SocialPlatformId = typeof socialPlatforms[number]['id'];

export type ScenarioBriefField = {
  id: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'multi' | 'list' | 'url' | 'price';
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: readonly { id: string; label: string }[];
};

export type PageRecipeId = 'landing' | 'sale' | 'link-in-bio' | 'code-animation';

export type ScenarioStepDefinition = {
  id: string;
  type: ScenarioStepType;
  title: string;
  hint: string;
  icon: string;
  accepts: readonly PoolKind[];
  produces: readonly PoolKind[];
  /** image | video: generator scenes; the first one is the default. */
  scenes?: readonly StudioScene['id'][];
  /** image | video | audio: English template with {field} placeholders seeded from the brief. */
  promptTemplate?: string;
  audioModes?: readonly ('speech' | 'music')[];
  page?: {
    recipe: PageRecipeId;
    designScenario: DesignScenarioId;
    templates: readonly string[];
    mode: 'create' | 'embed' | 'both';
    linkedStepId?: string;
  };
  motion?: {
    templateSource: 'motion' | 'black-friday' | 'none';
    skills: readonly string[];
    defaultDurationSeconds?: number;
  };
  platforms?: readonly SocialPlatformId[];
  optional?: boolean;
};

export type ScenarioId = 'motion-full-chain' | 'gemini-4-neon' | 'design-full-chain' | 'black-friday' | 'ai-influencer';

export type ScenarioLinkTarget =
  | 'motion-studio'
  | 'design-studio'
  | 'black-friday-collection'
  | 'model-hub:gemini-4'
  | 'template-library'
  | 'skills';

export type ScenarioDefinition = {
  id: ScenarioId;
  category: ScenarioCategory;
  title: string;
  subtitle: string;
  description: string;
  badge?: 'New' | 'Hot' | 'Top';
  icon: string;
  /** Existing Studio destinations that stay one click away. */
  links: readonly ScenarioLinkTarget[];
  briefFields: readonly ScenarioBriefField[];
  steps: readonly ScenarioStepDefinition[];
};

const toneOptions = [
  { id: 'bold', label: 'Bold & direct' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'premium', label: 'Premium' },
  { id: 'playful', label: 'Playful' },
  { id: 'informative', label: 'Informative' },
] as const;

const languageOptions = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: 'Simplified Chinese' },
] as const;

const durationOptions = [
  { id: '15', label: '15s' },
  { id: '30', label: '30s' },
  { id: '60', label: '60s' },
] as const;

const aspectOptions = [
  { id: '16:9', label: '16:9 Landscape' },
  { id: '9:16', label: '9:16 Vertical' },
  { id: '1:1', label: '1:1 Square' },
] as const;

const codeStyleOptions = [
  { id: 'art-animation', label: 'Art animation' },
  { id: 'product-film', label: 'Product film' },
  { id: 'explainer', label: 'Explainer' },
  { id: '3d-scene', label: '3D scene' },
  { id: 'game-interactive', label: 'Interactive game' },
] as const;

const platformOptions = socialPlatforms.map(platform => ({ id: platform.id, label: platform.label }));

const commonBriefFields: readonly ScenarioBriefField[] = [
  { id: 'idea', label: 'Core idea', kind: 'textarea', required: true, placeholder: 'Describe what you want to create and the outcome you want.', maxLength: 2000 },
  { id: 'audience', label: 'Audience', kind: 'text', placeholder: 'Who is this for?', maxLength: 200 },
  { id: 'tone', label: 'Copy tone', kind: 'select', options: toneOptions },
  { id: 'language', label: 'Copy language', kind: 'select', options: languageOptions },
  { id: 'brandName', label: 'Brand name', kind: 'text', placeholder: 'Optional brand or studio name', maxLength: 120 },
];

export const scenarioDefinitions = [
  {
    id: 'motion-full-chain',
    category: 'topic',
    title: 'Motion Studio',
    subtitle: 'Turn an idea into a motion film, soundtrack, and social posts',
    description: 'Plan a storyboard, create or upload visuals, build an editable Motion film with music, draft social posts, and download everything together.',
    badge: 'Top',
    icon: 'movie-line',
    links: ['motion-studio', 'template-library', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'concept', label: 'Film concept', kind: 'text', placeholder: 'A crisp product reveal with kinetic typography', maxLength: 300 },
      { id: 'durationSeconds', label: 'Duration', kind: 'select', options: durationOptions },
      { id: 'aspect', label: 'Aspect ratio', kind: 'select', options: aspectOptions },
      { id: 'visualStyle', label: 'Visual style', kind: 'text', placeholder: 'Editorial minimalism, bold lighting, clean type', maxLength: 300 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Define the film concept, audience, duration and visual direction.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
      },
      {
        id: 'storyboard',
        type: 'image',
        title: 'Storyboard',
        hint: 'Generate or upload key storyboard frames to anchor the motion film.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        scenes: ['text-to-image', 'shot-image'],
        promptTemplate: 'Storyboard frame for {concept}: {visualStyle}, {aspect} composition',
      },
      {
        id: 'motion-film',
        type: 'video',
        title: 'Motion film',
        hint: 'Animate a clip from your storyboard or create an editable Motion Studio project.',
        icon: 'movie-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Motion film sequence for {concept}: {visualStyle}, {aspect}, {durationSeconds}s',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-storyboard-to-motion', 'openmotion-bubble-field'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'soundtrack',
        type: 'audio',
        title: 'Soundtrack',
        hint: 'Generate background music or voiceover, or upload an audio track.',
        icon: 'music-2-line',
        accepts: ['text'],
        produces: ['audio'],
        audioModes: ['music', 'speech'],
        promptTemplate: '{tone} soundtrack for {concept}, {durationSeconds}s',
        optional: true,
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft platform-ready launch copy paired with your storyboard and film assets.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
      },
    ],
  },
  {
    id: 'gemini-4-neon',
    category: 'topic',
    title: 'Gemini 4 Neon',
    subtitle: 'Write interactive animations in code, plus film and posts',
    description: 'Create an interactive code animation, pair it with cover visuals and a companion film, then export your social posts and files together.',
    badge: 'New',
    icon: 'sparkling-line',
    links: ['model-hub:gemini-4', 'design-studio', 'motion-studio'],
    briefFields: [
      ...commonBriefFields,
      { id: 'concept', label: 'Animation concept', kind: 'text', placeholder: 'Reactive neon particle ribbon spelling the launch headline', maxLength: 300 },
      { id: 'codeStyle', label: 'Code animation style', kind: 'select', options: codeStyleOptions },
      { id: 'durationSeconds', label: 'Duration', kind: 'select', options: durationOptions },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Describe the code animation concept, check Gemini availability and browse examples.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
      },
      {
        id: 'code-animation',
        type: 'web-page',
        title: 'Code animation',
        hint: 'Create an interactive web animation, or let your Agent write custom Gemini code.',
        icon: 'code-s-slash-line',
        accepts: ['image'],
        produces: ['page'],
        page: {
          recipe: 'code-animation',
          designScenario: 'live-artifact',
          templates: ['live-artifact', 'webgl-neon-grid', 'webgl-particle-galaxy', 'webgl-experience'],
          mode: 'both',
        },
      },
      {
        id: 'stills',
        type: 'image',
        title: 'Key stills',
        hint: 'Generate or upload cover stills to complement the coded animation.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        scenes: ['text-to-image'],
        promptTemplate: 'Neon key still for {concept}, {codeStyle} visual direction, high contrast studio composition',
      },
      {
        id: 'film',
        type: 'video',
        title: 'Film & motion',
        hint: 'Turn your stills into a video cut or open an editable Motion project.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Fluid motion sequence for {concept} in {codeStyle} style, {durationSeconds}s',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-storyboard-to-motion', 'openmotion-neon-outline-type'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Write launch posts highlighting the live animation and companion film.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
  {
    id: 'design-full-chain',
    category: 'topic',
    title: 'Design Studio',
    subtitle: 'Go from idea to web page, visuals, promo video, and posts',
    description: 'Create a landing page, generate hero visuals, place them right into your page, add a promo video, and download everything together.',
    badge: 'New',
    icon: 'layout-line',
    links: ['design-studio', 'motion-studio', 'template-library'],
    briefFields: [
      ...commonBriefFields,
      { id: 'productName', label: 'Product name', kind: 'text', required: true, placeholder: 'Name of the product or project', maxLength: 120 },
      { id: 'valueProps', label: 'Key value props', kind: 'list', placeholder: 'Add up to 5 concrete benefits', maxLength: 240 },
      { id: 'cta', label: 'Primary call to action', kind: 'text', placeholder: 'Start free trial', maxLength: 80 },
      { id: 'visualStyle', label: 'Visual style', kind: 'text', placeholder: 'Warm daylight photography, crisp editorial grid', maxLength: 300 },
      { id: 'pageUrl', label: 'Destination URL', kind: 'url', placeholder: 'https://example.com', maxLength: 500 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Capture your product story, value propositions, CTA and visual direction.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
      },
      {
        id: 'landing-page',
        type: 'web-page',
        title: 'Landing page',
        hint: 'Describe your page, pick a starter layout, or connect an existing page.',
        icon: 'layout-line',
        accepts: ['image'],
        produces: ['page'],
        page: {
          recipe: 'landing',
          designScenario: 'prototype',
          templates: ['saas-landing', 'kami-landing', 'waitlist-page', 'pricing-page'],
          mode: 'create',
        },
      },
      {
        id: 'page-images',
        type: 'image',
        title: 'Page images',
        hint: 'Generate, edit or upload hero and gallery visuals for your landing page.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        scenes: ['text-to-image', 'image-edit', 'remove-background', 'relight'],
        promptTemplate: 'Hero image for {productName}: {valueProps}, {visualStyle}',
      },
      {
        id: 'embed-images',
        type: 'web-page',
        title: 'Embed images',
        hint: 'Place your chosen visuals right into your landing page.',
        icon: 'file-image-line',
        accepts: ['image', 'page'],
        produces: ['page'],
        page: {
          recipe: 'landing',
          designScenario: 'prototype',
          templates: ['saas-landing', 'kami-landing', 'waitlist-page', 'pricing-page'],
          mode: 'embed',
          linkedStepId: 'landing-page',
        },
      },
      {
        id: 'promo-video',
        type: 'video',
        title: 'Promo video',
        hint: 'Animate your hero image or start an editable Motion launch video.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Launch promo video for {productName}: {valueProps}, {visualStyle}',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-website-launch', 'openmotion-storyboard-to-motion'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft launch posts referencing your landing page and visuals.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
  {
    id: 'black-friday',
    category: 'campaign',
    title: 'Black Friday Sale',
    subtitle: 'Product shots, sale page, 30s promo video, and social posts',
    description: 'Create product photos, place them into a Black Friday sale page, make a 30-second promo video, and draft posts for every platform.',
    badge: 'Hot',
    icon: 'flashlight-line',
    links: ['black-friday-collection', 'design-studio', 'motion-studio', 'template-library', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'productName', label: 'Product name', kind: 'text', required: true, placeholder: 'Holiday Weekender Tote', maxLength: 120 },
      { id: 'productDescription', label: 'Product details', kind: 'textarea', placeholder: 'Materials, standout features and why shoppers buy it', maxLength: 1200 },
      { id: 'originalPrice', label: 'Original price', kind: 'price', placeholder: '$129', maxLength: 40 },
      { id: 'salePrice', label: 'Sale price', kind: 'price', placeholder: '$79', maxLength: 40 },
      { id: 'discountPercent', label: 'Discount', kind: 'text', placeholder: '40% OFF', maxLength: 40 },
      { id: 'promoCode', label: 'Promo code', kind: 'text', placeholder: 'BF40', maxLength: 40 },
      { id: 'saleWindow', label: 'Sale window', kind: 'text', placeholder: 'Nov 27 – Dec 1', maxLength: 120 },
      { id: 'cta', label: 'Call to action', kind: 'text', placeholder: 'Shop the Black Friday offer', maxLength: 80 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Set your product details, Black Friday pricing, promo code and campaign dates.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
      },
      {
        id: 'product-images',
        type: 'image',
        title: 'Product images',
        hint: 'Generate, relight, clean up or upload studio product photography.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        scenes: ['text-to-image', 'image-edit', 'remove-background', 'relight'],
        promptTemplate: 'Commercial product photo of {productName}: {productDescription}, bold Black Friday campaign lighting',
      },
      {
        id: 'detail-page',
        type: 'web-page',
        title: 'Detail page',
        hint: 'Build your sale detail page and embed your product images directly into the layout.',
        icon: 'layout-line',
        accepts: ['image'],
        produces: ['page'],
        page: {
          recipe: 'sale',
          designScenario: 'prototype',
          templates: ['saas-landing', 'pricing-page', 'poster-hero'],
          mode: 'both',
        },
      },
      {
        id: 'sales-film',
        type: 'video',
        title: '30s sales film',
        hint: 'Create a 30-second product promo video or pick a Black Friday style.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        scenes: ['image-to-video', 'video-multi-shot'],
        promptTemplate: '30s Black Friday sales film for {productName}: {salePrice}, code {promoCode}, {saleWindow}',
        motion: {
          templateSource: 'black-friday',
          skills: ['openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-sale-carousel'],
          defaultDurationSeconds: 30,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft sale announcements with pricing, promo codes and countdown dates for every channel.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
      },
    ],
  },
  {
    id: 'ai-influencer',
    category: 'role',
    title: 'AI Influencer',
    subtitle: 'Script, persona visuals, bio page, talking video, and posts',
    description: 'Write an episode script, keep your character consistent, build a link-in-bio page, record voiceover, create a talking video, and draft social posts.',
    badge: 'New',
    icon: 'user-3-line',
    links: ['design-studio', 'motion-studio', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'personaName', label: 'Persona name', kind: 'text', required: true, placeholder: 'Mina Park', maxLength: 120 },
      { id: 'niche', label: 'Creator niche', kind: 'text', placeholder: 'Tech explainers & daily workflow tips', maxLength: 200 },
      { id: 'platformFocus', label: 'Target platforms', kind: 'multi', options: platformOptions },
      { id: 'topic', label: 'Episode topic', kind: 'text', placeholder: '3 automation habits that save 5 hours a week', maxLength: 240 },
      { id: 'scriptOutline', label: 'Script notes', kind: 'textarea', placeholder: 'Hook, 3 talking points and closing question', maxLength: 3000 },
      { id: 'voiceStyle', label: 'Voice style', kind: 'text', placeholder: 'Warm, energetic conversational delivery', maxLength: 160 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief & script',
        hint: 'Define your persona, episode topic and beat-by-beat spoken script.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
      },
      {
        id: 'persona',
        type: 'image',
        title: 'Persona visuals',
        hint: 'Generate consistent character frames with up to 5 reference photos, or upload your own.',
        icon: 'user-3-line',
        accepts: ['image'],
        produces: ['image'],
        scenes: ['character', 'text-to-image'],
        promptTemplate: 'Consistent portrait of {personaName}, {niche} creator talking about {topic}, natural studio lighting',
      },
      {
        id: 'home-page',
        type: 'web-page',
        title: 'Link-in-bio page',
        hint: 'Build a creator profile page and embed your persona avatar and gallery visuals.',
        icon: 'global-line',
        accepts: ['image'],
        produces: ['page'],
        page: {
          recipe: 'link-in-bio',
          designScenario: 'prototype',
          templates: ['kami-landing', 'waitlist-page'],
          mode: 'both',
        },
      },
      {
        id: 'voice',
        type: 'audio',
        title: 'Voiceover & audio',
        hint: 'Generate speech from your script or background music, or upload recorded audio.',
        icon: 'voiceprint-line',
        accepts: ['text'],
        produces: ['audio'],
        audioModes: ['speech', 'music'],
        promptTemplate: '{voiceStyle} voiceover for {personaName} covering {topic}',
      },
      {
        id: 'talking-video',
        type: 'video',
        title: 'Talking video',
        hint: 'Animate your persona frame with synced audio or create a talking-head Motion project.',
        icon: 'movie-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        scenes: ['image-to-video', 'video-native-audio'],
        promptTemplate: 'Talking-head creator clip of {personaName} explaining {topic}, natural gestures and framing',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-talking-head-recreation'],
          defaultDurationSeconds: 30,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Adapt the episode hook and link-in-bio CTA for every social channel.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
] as const satisfies readonly ScenarioDefinition[];

export const findScenario = (id: unknown): ScenarioDefinition | undefined =>
  scenarioDefinitions.find(scenario => scenario.id === id);

export const findScenarioStep = (scenario: ScenarioDefinition, stepId: unknown): ScenarioStepDefinition | undefined =>
  scenario.steps.find(step => step.id === stepId);

export const scenariosByCategory = (category: ScenarioCategory): ScenarioDefinition[] =>
  scenarioDefinitions.filter(scenario => scenario.category === category);

export function fillScenarioTemplate(template: string, brief: Record<string, string | string[]>): string {
  const replaced = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const raw = brief[key];
    if (Array.isArray(raw)) {
      return raw.map(item => String(item).trim()).filter(Boolean).join(', ');
    }
    return typeof raw === 'string' ? raw.trim() : '';
  });
  return replaced
    .replace(/\bcode\s*(?=[,;.]|$)/gi, '')
    .replace(/:\s*,/g, ': ')
    .replace(/,\s*,+/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/([:,])\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Tools the scenario recipe composes. The handbook test asserts that the prompt contains each one. */
export const scenarioRecipeTools = [
  'openmotion_media_use',
  'openmotion_assets_use',
  'openmotion_design_project',
  'openmotion_design_edit',
  'openmotion_create_project',
  'openmotion_open_preview',
] as const;

export type ScenarioPromptIntegration = { previewUrl?: string; dataDirectory?: string };

export type ScenarioRunSummaryForPrompt = {
  id: string;
  title: string;
  revision: number;
  locale?: string;
  brief: Record<string, string | string[]>;
  activeStepId: string;
  steps: Record<string, {
    stepId: string;
    status: string;
    activeIterationId: string | null;
    links: { designProjectId?: string; motionProjectId?: string; motionSessionId?: string };
  }>;
  pool: readonly {
    id: string;
    kind: PoolKind;
    label: string;
    stepId: string | null;
    pinned?: boolean;
    ref:
      | { type: 'asset'; assetId: string; versionId: string }
      | { type: 'design'; projectId: string; versionId: string | null; revision: string }
      | { type: 'motion'; projectId: string; sessionId: string | null }
      | { type: 'text'; stepId: string; iterationId: string };
  }[];
};

function stepToolGuide(step: ScenarioStepDefinition): string {
  switch (step.type) {
    case 'brief':
      return 'Record brief updates with openmotion_assets_use (action=scenario, command=update_brief or command=add_iteration).';
    case 'web-page':
      return 'Create or open the HTML project with openmotion_design_project (action=create/get/open), write HTML/CSS/JS with openmotion_design_edit (action=write), and embed pinned images via openmotion_design_edit (action=import_asset) or scenario command=embed_image.';
    case 'image':
    case 'audio':
      return 'Inspect providers and models with openmotion_media_use (action=inspect/models), then generate with openmotion_assets_use (action=generate or scenario command=generate) and poll openmotion_assets_use (action=status or scenario command=sync).';
    case 'video':
      return 'Generate clips via openmotion_media_use + openmotion_assets_use, or create an editable film with openmotion_create_project, import pinned assets using openmotion_assets_use (action=import_to_project), and inspect with openmotion_open_preview.';
    case 'social-pack':
      return 'Save platform copy as a new iteration with openmotion_assets_use (action=scenario, command=add_iteration).';
  }
}

/** Shared instruction builder: Studio "Copy Agent handoff", the handbook mcpScenarios entry and the MCP docs. */
export function scenarioAgentPrompt(
  scenario: ScenarioDefinition,
  options?: { locale?: string | null; integration?: ScenarioPromptIntegration | null },
): string {
  const stepLines = scenario.steps.map(
    (step, index) => `${index + 1}. ${step.title} (${step.id}, ${step.type}): ${step.hint} ${stepToolGuide(step)}`,
  );
  const lines = [
    `Run the OpenMotion "${scenario.title}" (${scenario.id}) end-to-end scenario workflow.`,
    `Goal: ${scenario.description}`,
    options?.locale ? `Reply and write visible copy in: ${options.locale}` : null,
    options?.integration?.previewUrl ? `Studio URL: ${options.integration.previewUrl}` : null,
    options?.integration?.dataDirectory ? `Workspace: ${options.integration.dataDirectory}` : null,
    '',
    'Run tracking:',
    `- Use openmotion_assets_use with action=scenario (command=create, command=get, command=update_brief, command=sync) to track this run and share every asset in the run pool.`,
    '',
    'Ordered steps:',
    ...stepLines,
    '',
    'Tool composition across the workflow:',
    '- Media discovery & generation: call openmotion_media_use (action=inspect, action=models), then openmotion_assets_use (action=generate, action=status) or scenario command=generate/sync.',
    '- HTML web pages: call openmotion_design_project (action=create/get/open), then openmotion_design_edit (action=write and action=import_asset) to author HTML and embed pinned workspace assets.',
    '- Editable Motion films: call openmotion_create_project, import selected pool versions via openmotion_assets_use (action=import_to_project), and deliver via openmotion_open_preview.',
    '- Export from Shared assets or header: call openmotion_assets_use with action=scenario, command=export (optionally passing poolItemIds or stepIds) to build a downloadable ZIP package of selected assets or all deliverables.',
    '',
    'Delivery & safety requirements:',
    '- Pass an explicit stable requestId on every mutating call and current expectedRevision on run and design edits.',
    '- Never resubmit paid generation jobs automatically; poll the original jobId with status/sync.',
    '- Verify rendered pages, images and videos visually before marking steps done.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

function formatPoolRef(ref: ScenarioRunSummaryForPrompt['pool'][number]['ref']): string {
  switch (ref.type) {
    case 'asset':
      return `asset:${ref.assetId}@${ref.versionId}`;
    case 'design':
      return `design:${ref.projectId}@${ref.revision.slice(0, 12)}`;
    case 'motion':
      return `motion:${ref.projectId}${ref.sessionId ? ` (session ${ref.sessionId})` : ''}`;
    case 'text':
      return `text:${ref.stepId}/${ref.iterationId}`;
  }
}

function stepWriteBackLines(
  run: ScenarioRunSummaryForPrompt,
  focusStep: ScenarioStepDefinition,
  stepPrompt?: string,
): string[] {
  const trimmedPrompt = stepPrompt?.trim();
  const lines: string[] = [
    '',
    'Step write-back instructions:',
    trimmedPrompt ? `- Current step prompt: ${trimmedPrompt}` : '',
    `- Generate images, videos, or audio directly into this step and Shared assets: openmotion_assets_use (action=scenario, command=generate, runId=${run.id}, expectedRevision=${run.revision}, stepId="${focusStep.id}", modality, model, prompt), then poll command=sync until completed.`,
    `- Write an existing or workspace asset back into this step and Shared assets: openmotion_assets_use (action=scenario, command=add_pool, runId=${run.id}, expectedRevision=${run.revision}, items=[{ ref: { type: "asset", assetId, versionId }, stepId: "${focusStep.id}", source: "agent", label }]), plus command=add_iteration with outputs: [{ type: "pool", poolItemId }] when recording a new version in this step.`,
  ].filter(Boolean);

  if (focusStep.type === 'web-page') {
    lines.push(
      `- Author or update the HTML page via openmotion_design_project + openmotion_design_edit (action=write / action=import_asset), then link it back with openmotion_assets_use (action=scenario, command=link_design, runId=${run.id}, expectedRevision=${run.revision}, stepId="${focusStep.id}", designProjectId=<id>).`,
    );
  } else if (focusStep.type === 'brief') {
    lines.push(
      `- Save brief fields or scripts via openmotion_assets_use (action=scenario, command=update_brief / command=add_iteration, runId=${run.id}, expectedRevision=${run.revision}, stepId="${focusStep.id}"), plus command=add_pool for any accompanying visuals or videos.`,
    );
  } else if (focusStep.type === 'social-pack') {
    lines.push(
      `- Save platform posts via openmotion_assets_use (action=scenario, command=add_iteration, runId=${run.id}, expectedRevision=${run.revision}, stepId="${focusStep.id}", iteration={ source: "agent", outputs: [{ type: "social", posts }] }), plus command=add_pool for any accompanying visuals or videos.`,
    );
  } else if (focusStep.type === 'video') {
    lines.push(
      `- For an editable Motion project: openmotion_create_project + openmotion_assets_use (action=import_to_project) + openmotion_assets_use (action=scenario, command=link_motion, runId=${run.id}, expectedRevision=${run.revision}, stepId="${focusStep.id}", projectId=<id>).`,
    );
  }
  lines.push(
    `- Package all deliverables or specific Shared assets into a ZIP via openmotion_assets_use (action=scenario, command=export, runId=${run.id}, requestId, poolItemIds=[...]).`,
  );
  return lines;
}

/** Run-bound variant: adds runId, the current brief, pinned pool refs, linked design/motion ids, remaining steps and step write-back commands. */
export function scenarioRunAgentPrompt(
  scenario: ScenarioDefinition,
  run: ScenarioRunSummaryForPrompt,
  options?: { stepId?: string; stepPrompt?: string; locale?: string | null; integration?: ScenarioPromptIntegration | null },
): string {
  const focusStep = options?.stepId ? findScenarioStep(scenario, options.stepId) : undefined;
  const briefEntries = Object.entries(run.brief)
    .map(([key, value]) => {
      const formatted = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? '').trim();
      return formatted ? `- ${key}: ${formatted}` : null;
    })
    .filter((entry): entry is string => entry !== null);

  const poolLines = run.pool.slice(0, 30).map(item =>
    `- [${item.id}] (${item.kind}${item.pinned ? ', pinned' : ''}${item.stepId ? `, step=${item.stepId}` : ''}) "${item.label}" -> ${formatPoolRef(item.ref)}`,
  );

  const linkLines: string[] = [];
  const remainingSteps: string[] = [];
  for (const step of scenario.steps) {
    const st = run.steps[step.id];
    if (st?.links.designProjectId) linkLines.push(`- ${step.id}: designProjectId=${st.links.designProjectId}`);
    if (st?.links.motionProjectId) {
      linkLines.push(`- ${step.id}: motionProjectId=${st.links.motionProjectId}${st.links.motionSessionId ? ` sessionId=${st.links.motionSessionId}` : ''}`);
    }
    if (!st || (st.status !== 'done' && st.status !== 'skipped')) {
      remainingSteps.push(`${step.id} (${st?.status ?? 'todo'})`);
    }
  }

  const lines = [
    scenarioAgentPrompt(scenario, { locale: options?.locale ?? run.locale, integration: options?.integration }),
    '',
    'Current run state:',
    `- runId: ${run.id}`,
    `- title: ${run.title}`,
    `- expectedRevision: ${run.revision}`,
    `- activeStepId: ${run.activeStepId}`,
    focusStep ? `- focusedStep: ${focusStep.id} (${focusStep.title} — ${focusStep.hint})` : null,
    remainingSteps.length ? `- remainingSteps: ${remainingSteps.join(', ')}` : '- remainingSteps: none',
    ...(focusStep ? stepWriteBackLines(run, focusStep, options?.stepPrompt) : []),
    '',
    'Current brief:',
    ...(briefEntries.length ? briefEntries : ['- (no brief values recorded yet)']),
    '',
    'Linked projects:',
    ...(linkLines.length ? linkLines : ['- (none yet)']),
    '',
    'Shared asset pool:',
    ...(poolLines.length ? poolLines : ['- (empty)']),
    '',
    `Read the latest state first with openmotion_assets_use action=scenario command=get runId=${run.id}.`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
