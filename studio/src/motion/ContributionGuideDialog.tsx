import { Button } from 'open-design-ui/button';
import { useRef, useState } from 'react';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { SettingsDialog } from './settingsPrimitives';
import { contributionGuideUrls, contributionSubmissionPrompt, type ContributionKind } from './templateContribution';

const contributionCopy: Record<ContributionKind, { title: string; lead: string; shareStep: string }> = {
  template: {
    title: 'Submit template',
    lead: 'Share a video, reference or editable project with your Agent and paste the instruction below.',
    shareStep: 'Paste it into your Agent along with your video, reference or editable project.',
  },
  'brand-kit': {
    title: 'Submit Brand Kit',
    lead: 'Share a public website or local Brand Kit package with your Agent and paste the instruction below.',
    shareStep: 'Paste it into your Agent along with a public website or local Brand Kit package.',
  },
  skill: {
    title: 'Submit a skill',
    lead: 'Share a local SKILL.md folder or public repository with your Agent and paste the instruction below.',
    shareStep: 'Paste it into your Agent along with your SKILL.md folder or repository link.',
  },
};

/** Guided in-app dialog for contributing templates, Brand Kits and Skills through an Agent. */
export function ContributionGuideDialog({ kind, onClose, returnFocus }: {
  kind: ContributionKind;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const copy = contributionCopy[kind];
  const prompt = contributionSubmissionPrompt(kind, locale);
  const guideUrl = contributionGuideUrls[kind];

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.showToast(t('Copied to clipboard'), 'info', 'feedback');
    } catch {
      toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
    }
  }

  return <SettingsDialog title={t(copy.title)} onClose={onClose} returnFocus={returnFocus} className="om-contribution-dialog">
    <div className="om-contribution-guide" data-contribution-kind={kind}>
      <p className="om-muted">{t(copy.lead)}</p>
      <ol className="om-contribution-steps">
        <li>{t('Copy the instruction below.')}</li>
        <li>{t(copy.shareStep)}</li>
        <li>{t('Review the draft pull request your Agent prepares on GitHub.')}</li>
      </ol>
      <pre className="om-contribution-prompt">{prompt}</pre>
      <div className="om-contribution-actions">
        <Button variant="ghost" type="button" className="om-button h-auto" data-primary data-borderless onClick={() => void copyPrompt()}>
          <RemixIcon name="file-copy-line" size={15} />{t('Copy instruction')}
        </Button>
        <a className="om-text-link" href={guideUrl} target="_blank" rel="noopener noreferrer">
          {t('View guide on GitHub')}<RemixIcon name="external-link-line" size={14} />
        </a>
      </div>
    </div>
    <StudioToastViewport {...toast} />
  </SettingsDialog>;
}

/** Opens the guided contribution dialog instead of jumping directly to GitHub documentation. */
export function ContributionSubmitButton({ kind, label, className, primary, borderless, onTrack }: {
  kind: ContributionKind;
  label: string;
  className: string;
  primary?: boolean;
  borderless?: boolean;
  onTrack?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return <>
    <Button
      variant="plain"
      type="button"
      className={className}
      data-primary={primary || undefined}
      data-borderless={borderless || undefined}
      data-contribution-trigger={kind}
      aria-haspopup="dialog"
      onClick={event => {
        triggerRef.current = event.currentTarget;
        onTrack?.();
        setOpen(true);
      }}>
      {label}
    </Button>
    {open && <ContributionGuideDialog kind={kind} onClose={() => setOpen(false)} returnFocus={triggerRef.current} />}
  </>;
}
