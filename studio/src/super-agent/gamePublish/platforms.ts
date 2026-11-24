/**
 * Publish targets for the game "Publish" wizard.
 *
 * Each target lists only the steps the user must do personally (`steps`). Everything else is
 * Agent work: `prepare` runs as soon as the target is chosen, `after` runs once the user
 * finishes a step. The facts behind each step (who may submit for review, what needs a web
 * console, which platforms forbid third-party submission) follow the platform API audit in
 * outputs/2026-11-23/publish-button/research-platform-apis.md.
 *
 * All copy is an English source key translated through `t()` (game-publish-ui.json).
 */
import { PLAYABLE_NETWORKS } from './playableNetworks';

export type GamePublishPlatformId = 'wechat' | 'xiaohongshu' | 'douyin' | 'itch' | 'telegram' | 'playable-ad';

export interface GamePublishField {
  label: string;
  placeholder?: string;
  /** Value the Agent fills in for the user; shown read-only with a "Filled in for you" tag. */
  prefilled?: string;
  link?: { label: string; href: string };
}

export interface GamePublishStep {
  /** Special step bodies: Agent check results, or download + upload guidance. */
  kind?: 'checks' | 'download';
  /** Short name shown in the step bar. */
  short: string;
  title: string;
  /** Why the user has to do this personally. */
  why: string;
  /** Numbered sub-steps, also shown in the chat card. */
  todo: string[];
  fields?: GamePublishField[];
  /** Options the platform requires the user to choose personally (never preselected). */
  pick?: string[];
  qr?: boolean;
  links?: Array<{ label: string; href: string }>;
  cta: string;
  /** Title of the Agent work that runs after this step. */
  working: string;
  after: string[];
}

export interface GamePublishPlatform {
  id: GamePublishPlatformId;
  group: 'China' | 'Global' | 'Ads';
  name: string;
  /** Short effort summary shown on the platform tile. */
  effort: string;
  badge: string;
  color: string;
  prepare: string[];
  steps: GamePublishStep[];
  resultTitle: string;
  resultDetail: string;
  resultAction: string;
}

export const GAME_PUBLISH_PLATFORMS: readonly GamePublishPlatform[] = [
  {
    id: 'wechat',
    group: 'China',
    name: 'WeChat Mini Game',
    effort: 'You do 2 steps · review needs you',
    badge: '微',
    color: '#07c160',
    prepare: [
      'Checked the game runs as a Mini Game',
      'Switched page rendering to Canvas',
      'Added the Mini Game adapter (touch, storage, audio)',
      'Moved the score clear of the WeChat capsule button',
      'Package is 2.6 MB, under the 4 MB main package limit',
    ],
    steps: [
      {
        short: 'Account',
        title: 'Enter the AppID and upload key',
        why: 'Only your Mini Game account can get the AppID and upload key.',
        todo: [
          'Open the WeChat console; register a Mini Game account if you do not have one',
          'Copy the AppID from Development settings',
          'Generate a code upload key',
          'Add the IP address below to the allowlist',
        ],
        fields: [
          { label: 'AppID', placeholder: 'Starts with wx, 18 characters', link: { label: 'Open WeChat console', href: 'https://mp.weixin.qq.com/' } },
          { label: 'Code upload key', placeholder: 'Paste the key' },
          { label: 'IP allowlist', prefilled: '203.0.113.24' },
        ],
        cta: 'I filled it in',
        working: 'Uploading the trial version and preparing review materials',
        after: ['Uploaded trial version 1.0.0', 'Created the trial QR code', 'Captured 11 device screenshots', 'Wrote the description, how to play and privacy notes'],
      },
      {
        short: 'Review',
        title: 'Try it, then submit for review',
        why: 'WeChat only lets you submit for review yourself.',
        todo: [
          'Scan the code with WeChat and play the trial version',
          'Download the review materials',
          'Submit in the WeChat console under Version management; complete ICP filing first if needed (13–37 working days)',
        ],
        qr: true,
        links: [
          { label: 'Download review materials', href: '#' },
          { label: 'Open WeChat console', href: 'https://mp.weixin.qq.com/' },
        ],
        cta: 'I submitted it',
        working: 'Recording the submission',
        after: ['I will tell you here when WeChat finishes the review'],
      },
    ],
    resultTitle: 'Sent to WeChat for review',
    resultDetail: 'Trial version 1.0.0 uploaded',
    resultAction: 'Open WeChat console',
  },
  {
    id: 'xiaohongshu',
    group: 'China',
    name: 'Xiaohongshu Mini Tool',
    effort: 'Scan once · review takes minutes',
    badge: '书',
    color: '#ff2442',
    prepare: ['Moved inline scripts into files', 'Converted the code to ES2017', 'Offline run check passed'],
    steps: [
      {
        short: 'Authorize',
        title: 'Scan with the Xiaohongshu app',
        why: 'Only you can approve the authorization.',
        todo: ['Scan the code below with the Xiaohongshu app', 'Allow OpenDesign to upload Mini Tools for you'],
        qr: true,
        cta: 'I scanned it',
        working: 'Uploading and submitting for review',
        after: ['Authorized', 'Uploaded the Mini Tool package', 'Submitted for review'],
      },
    ],
    resultTitle: 'Submitted to Xiaohongshu',
    resultDetail: 'Usually reviewed within minutes; then you can attach it to a note',
    resultAction: 'View review status',
  },
  {
    id: 'douyin',
    group: 'China',
    name: 'Douyin Interactive Space',
    effort: 'Invite code · review in 1 working day',
    badge: '抖',
    color: '#161823',
    prepare: ['Packaged with index.html entry: 2.4 MB (limit 8 MB)'],
    steps: [
      {
        short: 'Authorize',
        title: 'Enter the invite code and scan',
        why: 'Interactive Space opens by invite code, and only you can approve the authorization.',
        todo: ['Enter your invite code', 'Scan with the Douyin app to authorize'],
        fields: [{ label: 'Invite code', placeholder: 'DY-XXXX' }],
        qr: true,
        cta: 'I scanned it',
        working: 'Uploading and submitting for review',
        after: ['Invite code accepted', 'Authorized', 'Uploaded through the official channel', 'Submitted for review'],
      },
    ],
    resultTitle: 'Submitted to Douyin',
    resultDetail: 'Result within 1 working day',
    resultAction: 'View review status',
  },
  {
    id: 'itch',
    group: 'Global',
    name: 'itch.io',
    effort: 'First time 2 steps · then one-click updates',
    badge: 'it',
    color: '#fa5c5c',
    prepare: ['Packaged an HTML5 zip with index.html'],
    steps: [
      {
        short: 'Connect',
        title: 'Create the game page and add an API key',
        why: 'itch.io has no API for creating pages, so the first page is made on the website. You only do this once.',
        todo: ['Create a new project and paste its address here', 'Generate an API key in Settings and paste it here'],
        fields: [
          { label: 'Game page address', placeholder: 'https://you.itch.io/your-game', link: { label: 'Create project', href: 'https://itch.io/game/new' } },
          { label: 'API key', placeholder: 'Paste the key', link: { label: 'Get API key', href: 'https://itch.io/user/settings/api-keys' } },
        ],
        cta: 'I filled it in',
        working: 'Uploading to itch.io',
        after: ['Saved the API key securely', 'Uploaded with the official butler tool'],
      },
      {
        short: 'Playable',
        title: 'Make the page playable in the browser',
        why: 'This setting can only be changed on the website. Later updates are one click.',
        todo: ['Open the page editor', 'Set the kind to HTML and tick "Playable in browser"', 'Save'],
        links: [{ label: 'Open page editor', href: 'https://itch.io/dashboard' }],
        cta: 'Saved',
        working: 'Checking the page',
        after: ['The page plays in the browser', 'Live'],
      },
    ],
    resultTitle: 'Live on itch.io',
    resultDetail: 'you.itch.io/your-game',
    resultAction: 'Open game page',
  },
  {
    id: 'telegram',
    group: 'Global',
    name: 'Telegram Mini App',
    effort: 'Confirm once · needs technical check',
    badge: 'TG',
    color: '#2aabee',
    prepare: ['Added the Telegram Mini App script'],
    steps: [
      {
        short: 'Confirm',
        title: 'Confirm in Telegram',
        why: 'Only you can confirm creating the bot in Telegram.',
        todo: ['Open Telegram with the button below', 'Confirm creating the bot'],
        links: [{ label: 'Open in Telegram', href: 'https://t.me/' }],
        cta: 'I confirmed',
        working: 'Creating the bot and attaching the game',
        after: ['Created the bot', 'Set the game as the menu button', 'Opens in Telegram'],
      },
    ],
    resultTitle: 'Live on Telegram',
    resultDetail: 'Opens from the bot menu button',
    resultAction: 'Open in Telegram',
  },
  {
    id: 'playable-ad',
    group: 'Ads',
    name: 'Playable ad export',
    effort: 'No account needed · export and upload yourself',
    badge: 'Ad',
    color: '#a26bff',
    prepare: [],
    steps: [
      {
        short: 'Network',
        title: 'Which ad network?',
        why: 'You decide where to advertise; the Agent packages to that network\'s rules.',
        todo: ['Choose one ad network'],
        pick: PLAYABLE_NETWORKS.map(network => network.name),
        cta: 'Check the package',
        working: 'Checking against the network rules',
        after: ['Read the network rules', 'Inlined external resources into one file', 'Rewrote the store button for this network', 'Measured the package size'],
      },
      {
        short: 'Check',
        kind: 'checks',
        title: 'Size and rule check',
        why: 'Review what the Agent changed for this network before you add store links.',
        todo: ['Review the check results'],
        cta: 'Looks good',
        working: 'Saving the check results',
        after: ['Check results saved'],
      },
      {
        short: 'Store links',
        title: 'Add your store links',
        why: 'Only you know where players should download the app. The store button opens these links.',
        todo: ['Paste the App Store link', 'Paste the Google Play link'],
        fields: [
          { label: 'iOS App Store link', placeholder: 'https://apps.apple.com/app/id…' },
          { label: 'Google Play link', placeholder: 'https://play.google.com/store/apps/details?id=…' },
        ],
        cta: 'Build package',
        working: 'Building the playable ad package',
        after: ['Wrote the store links into the store button', 'Packaged to the network format', 'Created the export package'],
      },
      {
        short: 'Download',
        kind: 'download',
        title: 'Download, then upload in your ad console',
        why: 'Networks do not accept uploads from app builders, so you upload the package in your own ad account.',
        todo: ['Download the package', 'Upload it in your ad network console and preview it there'],
        cta: 'I downloaded it',
        working: 'Finishing up',
        after: ['Export recorded'],
      },
    ],
    resultTitle: 'Playable ad exported',
    resultDetail: 'Upload the package in your ad account',
    resultAction: 'Download package',
  },
];

/** Shown once, under the platform list. App Store: Apple guideline 4.2.6; TikTok Mini Games: company accounts only, no HTML games. */
export const UNSUPPORTED_PLATFORMS_NOTE = 'Not supported: App Store (Apple does not allow submission by app builders) and TikTok Mini Games (company accounts only)';

export const LINK_PUBLISH_STEPS = ['Packaged the game (2.6 MB)', 'Created the share card and cover', 'Published the link'];

export function gamePublishPlatform(id: GamePublishPlatformId | undefined): GamePublishPlatform | undefined {
  return GAME_PUBLISH_PLATFORMS.find(platform => platform.id === id);
}
