import type { ScenarioId } from '../../../shared/scenarios';
import speakerStudio from '../motion/scene-art/speaker-studio.webp';
import { motionSkills, motionStudioCover, archivedSkillPoster } from '../motion/skillCatalog';
import { findModelHub } from '../motion/modelHubs';

const covers: Record<ScenarioId, string> = {
  'motion-full-chain': motionStudioCover?.poster ?? '',
  'gemini-4-neon': findModelHub('gemini-4')!.poster,
  'design-full-chain': archivedSkillPoster('color-pop-poster'),
  'black-friday': motionSkills.find(s => s.id === 'openmotion-sale-carousel')?.cover?.poster ?? archivedSkillPoster('sale-countdown'),
  'ai-influencer': speakerStudio,
};

export const scenarioCover = (id: ScenarioId) => covers[id];
