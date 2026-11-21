import { describe, expect, it } from 'vitest';
import { scenarioCategories, scenarioDefinitions, socialPlatforms } from '../../../shared/scenarios';
import { isKnownMessage, languages, translate } from './messages';
import scenarioUi from './scenario-ui.json';
import studioNavigationUi from './studio-navigation-ui.json';
import mcpUi from './mcp-ui.json';

const nonEnglishLocales = languages.map(language => language.locale).filter(locale => locale !== 'en');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const mcpTools = (text: string) => (text.match(/openmotion_\w+/g) ?? []).sort();

describe('scenario workflow i18n resources', () => {
  it('keeps identical key sets, non-empty translations and matching placeholders across all 10 non-English locales', () => {
    expect(Object.keys(scenarioUi).sort()).toEqual([...nonEnglishLocales].sort());
    const keys = Object.keys(scenarioUi['zh-CN']).sort();
    expect(keys.length).toBeGreaterThan(150);

    for (const locale of nonEnglishLocales) {
      const entries = scenarioUi[locale as keyof typeof scenarioUi] as Record<string, string>;
      expect(Object.keys(entries).sort(), locale).toEqual(keys);
      for (const [source, value] of Object.entries(entries)) {
        expect(value.trim(), `${locale}: ${source}`).not.toBe('');
        expect(placeholders(value), `${locale}: ${source}`).toEqual(placeholders(source));
        expect(mcpTools(value), `${locale}: ${source}`).toEqual(mcpTools(source));
      }
    }
  });

  it('forbids 工程 in zh-CN scenario translations and new navigation/MCP entries', () => {
    for (const [source, value] of Object.entries(scenarioUi['zh-CN'])) {
      expect(value, `scenario-ui.json: ${source}`).not.toContain('工程');
    }
    const navKeys = [
      'Workflows', 'Topics', 'Campaigns', 'Roles', 'All workflows', 'Topics, campaigns and roles',
      'Start workflow', 'Guided workflows', 'Recent', 'Start guided workflow',
      'Start Gemini 4 Neon workflow', 'Start Black Friday workflow', 'AI Influencer',
      'Pick a goal and go from idea to finished visuals, pages, videos, and posts.',
      'Featured', 'Recreate this template', 'Templates could not be loaded.',
    ];
    for (const key of navKeys) {
      const value = studioNavigationUi['zh-CN'][key as keyof typeof studioNavigationUi['zh-CN']];
      expect(value, `studio-navigation-ui.json: ${key}`).toBeTruthy();
      expect(value, `studio-navigation-ui.json: ${key}`).not.toContain('工程');
      for (const locale of nonEnglishLocales) {
        expect(translate(locale, key).trim(), `${locale}: ${key}`).not.toBe('');
      }
    }
    const mcpKeys = [
      'Run an end-to-end scenario workflow',
      'Open a Topic, Campaign or Role from Workflows to go from an idea to a web page, images, video, audio, social posts and one ZIP package, sharing every asset between steps.',
      'Run the Black Friday campaign workflow',
      'Embed workspace images into an HTML page',
    ];
    for (const key of mcpKeys) {
      const value = mcpUi['zh-CN'][key as keyof typeof mcpUi['zh-CN']];
      expect(value, `mcp-ui.json: ${key}`).toBeTruthy();
      expect(value, `mcp-ui.json: ${key}`).not.toContain('工程');
    }
  });

  it('covers every scenario catalog string across all 10 non-English locales', () => {
    const strings = new Set<string>();
    for (const category of scenarioCategories) strings.add(category.label);
    for (const platform of socialPlatforms) strings.add(platform.label);
    for (const scenario of scenarioDefinitions) {
      strings.add(scenario.title);
      strings.add(scenario.subtitle);
      strings.add(scenario.description);
      for (const field of scenario.briefFields) {
        strings.add(field.label);
        if (field.placeholder) strings.add(field.placeholder);
        if (field.options) {
          for (const option of field.options) strings.add(option.label);
        }
      }
      for (const step of scenario.steps) {
        strings.add(step.title);
        strings.add(step.hint);
      }
    }

    for (const source of strings) {
      expect(isKnownMessage(source), `missing zh-CN mapping for "${source}"`).toBe(true);
      for (const locale of nonEnglishLocales) {
        expect(translate(locale, source).trim(), `${locale}: ${source}`).not.toBe('');
      }
    }
  });

  it('covers StepCapabilityBar, Shared assets sidebar, and export/import controls across all 10 non-English locales', () => {
    const uiStrings = [
      'Hot',
      'Shared assets',
      'Shared assets ({count})',
      'Show shared assets ({count})',
      'Hide shared assets',
      'Collapse shared assets',
      'Resize shared assets panel',
      'Sync assets',
      'Synced latest assets',
      'Agent tools',
      'Models and Agent tools',
      'Create with models or an Agent',
      'Work with your Agent via MCP',
      'Generate image / video',
      'Copy MCP prompt',
      'Copied MCP prompt. Paste into your Agent to write assets back into this step.',
      'Sync',
      'Media type',
      'Attach reference image',
      'Change reference image',
      'Describe the image to generate',
      'Describe the video clip to generate',
      '{count} generating',
      'Generation started. New assets will appear in Shared assets.',
      'Import',
      'Import ({count})',
      'Import all ({count})',
      'Import from workspace',
      'Import from workspace…',
      'Import to shared assets',
      'Import Design pages',
      'Import Design pages…',
      'Import Motion projects',
      'Import Motion projects…',
      'Select',
      'Select all',
      'Select all ({count})',
      'Deselect all',
      'Export',
      'Export ({count})',
      'Export all',
      'Export all (ZIP)',
      'Export selected ({count})',
      'Export filtered ({count})',
      'Export options',
      'Export ready',
      'Could not build export ZIP',
      'Summary JSON copied',
      'Copy summary (JSON)',
      'Copy for Agent',
      'That asset is no longer in shared assets.',
      'Could not save brief version.',
      'Page version',
      'Version',
    ];

    for (const source of uiStrings) {
      expect(isKnownMessage(source), `missing zh-CN mapping for "${source}"`).toBe(true);
      expect(translate('zh-CN', source), `zh-CN: ${source}`).not.toBe(source);
      for (const locale of nonEnglishLocales) {
        const translated = translate(locale, source);
        expect(translated.trim(), `${locale}: ${source}`).not.toBe('');
        if (!(source === 'Version' && (locale === 'de' || locale === 'fr'))) {
          expect(translated, `${locale}: ${source} was not localized`).not.toBe(source);
        }
      }
    }
  });
});
