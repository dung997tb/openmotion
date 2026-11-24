import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { GITHUB_REPOSITORY } from './githubRepository';

export function McpSiteFooter({
  community,
  onScrollTo,
  onOpenSkill,
  onOpenLibrary,
  onOpenProviders,
  onCommunityClick,
  onDocClick,
  onReportIssue,
}: {
  community: { href: string; label: string };
  onScrollTo: (id: string) => void;
  onOpenSkill: (skillId: string) => void;
  onOpenLibrary: (trigger?: HTMLElement) => void;
  onOpenProviders: () => void;
  onCommunityClick: () => void;
  onDocClick: (doc: 'skills' | 'mcp_tools' | 'docs_home' | 'repository') => void;
  onReportIssue: () => void;
}) {
  const { t } = useI18n();

  return (
    <footer className="om-mcp-site-footer">
      <div className="om-mcp-site-footer-inner">
        <div className="om-mcp-footer-intro">
          <div className="om-mcp-footer-brand-kicker">OPEN DESIGN</div>
          <h2 className="om-mcp-footer-brand-title">
            THE OPEN<br />SOURCE AI-<br />NATIVE<br />CREATIVE SUITE
          </h2>
          <div className="om-mcp-footer-meta-links">
            <a href={community.href} target="_blank" rel="noopener noreferrer" onClick={onCommunityClick}>
              {community.label}
              <RemixIcon name="arrow-right-up-line" size={14} />
            </a>
            <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer" onClick={() => onDocClick('repository')}>
              GitHub
              <RemixIcon name="arrow-right-up-line" size={14} />
            </a>
          </div>
        </div>

        <div className="om-mcp-site-footer-right">
          <nav className="om-mcp-site-footer-cols" aria-label={t('MCP resources')}>
            <div className="om-mcp-site-footer-col">
              <h4>{t('Create')}</h4>
              <ul>
                <li><Button variant="plain" onClick={event => onOpenLibrary(event.currentTarget)}>{t('Template library')}</Button></li>
                <li><Button variant="plain" onClick={() => onScrollTo('band-ecom')}>{t('Product launch films')}</Button></li>
                <li><Button variant="plain" onClick={() => onOpenSkill('three-js')}>{t('3D motion')}</Button></li>
                <li><Button variant="plain" onClick={() => onOpenSkill('openmotion-talking-head-recreation')}>{t('Viral recreation')}</Button></li>
                <li><Button variant="plain" onClick={() => onScrollTo('gallery')}>{t('Explore more scene templates')}</Button></li>
              </ul>
            </div>

            <div className="om-mcp-site-footer-col">
              <h4>{t('Connect')}</h4>
              <ul>
                <li><Button variant="plain" className="om-mcp-footer-current" onClick={() => onScrollTo('mcp-title')}>{t('MCP · Connect Agent')}</Button></li>
                <li><Button variant="plain" onClick={onOpenProviders}>{t('Manage providers')}</Button></li>
                <li><Button variant="plain" onClick={() => onScrollTo('dev-drawer')}>{t('Developer technical reference')}</Button></li>
                <li><Button variant="plain" onClick={() => onScrollTo('mcp-faq')}>{t('Frequently asked questions')}</Button></li>
              </ul>
            </div>

            <div className="om-mcp-site-footer-col">
              <h4>{t('Resources')}</h4>
              <ul>
                <li><a href={`${GITHUB_REPOSITORY}/blob/main/docs/skills.md`} target="_blank" rel="noreferrer" onClick={() => onDocClick('skills')}>{t('Production Skills')}</a></li>
                <li><a href={`${GITHUB_REPOSITORY}/blob/main/docs/mcp-phase1-tools.md`} target="_blank" rel="noreferrer" onClick={() => onDocClick('mcp_tools')}>{t('MCP tool reference')}</a></li>
                <li><a href={`${GITHUB_REPOSITORY}/tree/main/docs`} target="_blank" rel="noreferrer" onClick={() => onDocClick('docs_home')}>{t('Documentation')}</a></li>
                <li><a href={`${GITHUB_REPOSITORY}/issues/new/choose`} target="_blank" rel="noreferrer" onClick={onReportIssue}>{t('Report an issue')}</a></li>
              </ul>
            </div>
          </nav>

          <div className="om-mcp-site-footer-skills">
            <a className="om-mcp-site-footer-skills-head" href={`${GITHUB_REPOSITORY}/blob/main/docs/skills.md`} target="_blank" rel="noreferrer" onClick={() => onDocClick('skills')}>
              <span>Skills</span>
              <RemixIcon name="arrow-right-line" size={14} />
            </a>
            <div className="om-mcp-site-footer-skills-row">
              <Button variant="plain" onClick={() => onOpenSkill('openmotion-talking-head-recreation')}>{t('Talking-head & editing')}</Button>
              <Button variant="plain" onClick={() => onOpenSkill('openmotion-splash-float-product')}>{t('E-commerce marketing')}</Button>
              <Button variant="plain" onClick={() => onScrollTo('band-recreate')}>{t('Brand & intros')}</Button>
              <Button variant="plain" onClick={() => onOpenSkill('openmotion-design-styles')}>{t('Creative styles')}</Button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
