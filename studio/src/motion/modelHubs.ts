import geminiPoster from './model-hubs/gemini-4.svg?url';
import { gemini4Videos, type HubVideo } from './gemini4Videos';
import { findMediaStudio } from '../../../shared/studio-catalog';
import { studioDestination, type StudioDestination } from './creativeStudios';
import seedanceHero from './model-hubs/seedance-2-5/hero.webp?no-inline';
import gptImageHero from './model-hubs/gpt-image-2-6/hero.webp?no-inline';
import { buildGptImageShowcaseCases, buildSeedanceShowcaseCases } from './model-hubs/curatedCases';

/** Local posters for posts whose X cover is a blank first frame; captured mid-video. */
const posterOverrides: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob('./model-hubs/gemini-4/posters/*.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>)
  .map(([path, url]) => [path.split('/').pop()!.replace(/\.jpg$/, ''), url]));
const withPoster = (video: HubVideo): HubVideo => posterOverrides[video.id] ? { ...video, poster: posterOverrides[video.id] } : video;

export interface HubShowcaseCase {
  id: string;
  title: string;
  titleZh?: string;
  tag: string;
  tagZh?: string;
  poster: string;
  /** Optional preview video URL; played strictly on card hover/focus or inside the preview lightbox. */
  video?: string;
  /** Optional higher-resolution video URL for lightbox playback; falls back to `video` then `poster`. */
  videoHd?: string;
  /** Original community creator handle, displayed in the preview lightbox when available. */
  author?: string;
  /** Original public showcase post URL for creator attribution. */
  sourceUrl?: string;
  /** Natural width/height ratio used for staggered masonry layout (e.g. 9/16, 4/3, 16/9, 1). */
  aspectRatio: number;
  prompt: string;
  promptZh?: string;
  destination: StudioDestination;
}

/**
 * Model hubs are editorial landing pages for a model family. Facts come from the
 * vendor's own announcement; availability is always read from the live gateway
 * catalog, so a hub never claims a model is usable before a provider serves it.
 */
export interface ModelHub {
  id: string;
  title: string;
  /** Full name of the model people can use today, shown wherever access is explained. */
  modelName: string;
  /** Full name of the newest release, shown on the Explore banner. */
  latestModel: string;
  vendor: string;
  eyebrow: string;
  eyebrowZh?: string;
  summary: string;
  summaryZh?: string;
  poster: string;
  /** Matches gateway model ids or model ids served for this family. */
  modelPattern: RegExp;
  /** Matches companion media models from the same vendor already in the catalog. */
  companionPattern: RegExp;
  provider: string;
  /** Optional primary Studio destination when launching directly from the hub hero. */
  primaryDestination?: StudioDestination;
  primaryCta?: string;
  primaryCtaZh?: string;
  /** Optional Black Friday promo note / bundled models highlighted in the hero. */
  promoModels?: string[];
  promoBadge?: string;
  promoBadgeZh?: string;
  /** Curated 1-click remixable showcase cases for this model hub. */
  cases?: HubShowcaseCase[];
  casesHeading?: string;
  casesHeadingZh?: string;
  /** Community videos made with this family; media stays on the original posts. */
  videos: HubVideo[];
}

const cinema = findMediaStudio('cinema')!;
const design = findMediaStudio('design')!;
const cinemaTextToVideo = studioDestination(cinema, 'text-to-video');
const designTextToImage = studioDestination(design, 'text-to-image');

export const modelHubs: ModelHub[] = [
  {
    id: 'seedance-2-5',
    title: 'Seedance 2.5',
    modelName: 'Seedance 2.5',
    latestModel: 'Seedance 2.5',
    vendor: 'ByteDance',
    eyebrow: 'Black Friday 50% Off',
    eyebrowZh: '黑五首年 5 折',
    summary: 'Multi-shot cinema video generation · Unlock with Go Plus or above.',
    summaryZh: '电影级多镜头视频生成 · 开通 Go Plus 及以上解锁，72 套精选大片一键同款',
    poster: seedanceHero,
    provider: 'opendesign',
    modelPattern: /seedance[\s._/-]*v?2[.\s_-]5(?!\d|\.\d)/i,
    companionPattern: /seedream|kling|veo|wan/i,
    primaryDestination: cinemaTextToVideo,
    primaryCta: 'Start Creating',
    primaryCtaZh: '前往创作',
    promoBadge: 'Black Friday 50% Off',
    promoBadgeZh: '黑五 5 折',
    casesHeading: '1-Click Cinema Templates',
    casesHeadingZh: '精选同款大片',
    cases: buildSeedanceShowcaseCases(cinemaTextToVideo),
    videos: [],
  },
  {
    id: 'gpt-image-2-6',
    title: 'GPT Image 2.6',
    modelName: 'GPT Image 2.6',
    latestModel: 'GPT Image 2.6',
    vendor: 'OpenAI',
    eyebrow: 'Black Friday Unlimited',
    eyebrowZh: '黑五限时无限用',
    summary: 'Annual Pro & Max 7-day unlimited · Includes Seedream 5.5 / 5.0 & Nano Banana 2 (API supported).',
    summaryZh: '年度 Pro / Max 7 天无限畅用 · 同步覆盖 Seedream 5.5 / 5.0 / Nano Banana 2，支持 API 调用',
    poster: gptImageHero,
    provider: 'opendesign',
    modelPattern: /gpt[\s._/-]*image[\s._/-]*v?2[.\s_-]6(?!\d|\.\d)|gpt[\s._/-]*image/i,
    companionPattern: /seedream|nano-banana|flux|imagen/i,
    primaryDestination: designTextToImage,
    primaryCta: 'Create Image',
    primaryCtaZh: '前往生图',
    promoModels: ['GPT Image 2.6', 'Seedream 5.5', 'Seedream 5.0', 'Nano Banana 2'],
    promoBadge: '7 Days Unlimited',
    promoBadgeZh: '7 天无限畅用',
    casesHeading: 'Featured Image Recipes',
    casesHeadingZh: '旗舰生图样张',
    cases: buildGptImageShowcaseCases(designTextToImage),
    videos: [],
  },
  {
    id: 'gemini-4',
    title: 'Gemini 4',
    modelName: 'Gemini 4 Argon',
    latestModel: 'Gemini 4 Neon',
    vendor: 'Google DeepMind',
    eyebrow: 'New model',
    summary: 'Google’s newest frontier model writes whole animations in code. The hottest Gemini 4 videos on X are all here.',
    poster: geminiPoster,
    provider: 'gemini',
    modelPattern: /gemini-4/i,
    companionPattern: /google\/|nano-banana|veo|imagen/i,
    videos: gemini4Videos.map(withPoster),
  },
];

export const findModelHub = (id: string | null | undefined) => modelHubs.find(hub => hub.id === id) ?? null;
