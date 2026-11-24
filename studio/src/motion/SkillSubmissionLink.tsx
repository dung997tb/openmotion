import { useI18n } from '../i18n/I18n';
import { ContributionSubmitButton } from './ContributionGuideDialog';
import { reportSkillSubmitClicked } from './pageTracking';
import { send } from './reporting';
import { contributionGuideUrls } from './templateContribution';

/** The contribution guide section with the paste-ready Agent brief for a new library Skill. */
export const skillSubmissionUrl = contributionGuideUrls.skill;

export function SkillSubmissionLink({ explore = false }: { explore?: boolean }) {
  const { t } = useI18n();
  return <ContributionSubmitButton
    kind="skill"
    label={t('Submit a skill')}
    className={explore ? 'om-button' : 'om-gallery-submit'}
    primary={explore}
    borderless
    onTrack={explore ? () => send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'submit_skill' }) : reportSkillSubmitClicked}
  />;
}
