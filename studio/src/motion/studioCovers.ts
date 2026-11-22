import type { CreativeStudio } from '../../../shared/studio-catalog';
import { studioScenes } from './creativeStudios';
import { sceneExamples } from './sceneShowcase';
import { motionSkills } from './skillCatalog';
import gameCover from './game/community/evensong.jpg';
import glassSculpture from './scene-art/studio-glass-sculpture.jpg';

const skillPoster = (id: string) => motionSkills.find(skill => skill.id === id)?.cover?.poster;

/** One cover per creative studio for the All studios collection, taken from the studio's own examples. */
export function creativeStudioCover(studio: CreativeStudio): string | undefined {
  if (studio.id === 'motion') return skillPoster('openmotion-storyboard-to-motion');
  if (studio.id === 'game') return gameCover;
  if (studio.id === '3d') return glassSculpture;
  if (studio.surface === 'techniques') {
    const poster = studio.techniques.map(skillPoster).find(Boolean);
    if (poster) return poster;
  }
  const scene = studio.scenes[0] ? studioScenes.find(item => item.id === studio.scenes[0]) : undefined;
  return scene ? sceneExamples[scene.id][0]?.poster : undefined;
}
