import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { scenarioCategories, type ScenarioDefinition } from '../../../shared/scenarios';
import type { ScenarioRun, ScenarioRunSummary } from '../../../shared/scenario-runs';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { FieldInput } from '../components/ui/FormField';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { BackToExploreButton } from '../motion/BackToExploreButton';
import { scenarioCover } from './scenarioCovers';

export type ScenarioHeaderProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  runs: ScenarioRunSummary[];
  runsLoading: boolean;
  onLoadRuns(): void;
  onSelectRun(runId: string): void;
  onNewRun(): void;
  onRenameRun(title: string): Promise<void>;
  onArchiveRun(): Promise<void>;
  onExplore(): void;
  onOpenHub(): void;
  breadcrumb?: ReactNode;
  poolOpen: boolean;
  poolCount: number;
  onTogglePool(): void;
  onCopyAgentHandoff(): void;
  onExportBundle(): void;
  busy: ReadonlySet<string>;
};

export function ScenarioHeader({
  scenario,
  run,
  runs,
  runsLoading,
  onLoadRuns,
  onSelectRun,
  onNewRun,
  onRenameRun,
  onArchiveRun,
  onExplore,
  onOpenHub,
  breadcrumb,
  poolOpen,
  poolCount,
  onTogglePool,
  onCopyAgentHandoff,
  onExportBundle,
  busy,
}: ScenarioHeaderProps) {
  const { t, formatDate } = useI18n();
  const coverSrc = scenarioCover(scenario.id);
  const [coverFailed, setCoverFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [coverSrc]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const category = scenarioCategories.find(item => item.id === scenario.category);

  const beginRename = () => {
    if (!run) return;
    skipBlurCommitRef.current = false;
    setDraftTitle(run.title);
    setRenaming(true);
  };

  const commitRename = async () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    const trimmed = draftTitle.trim();
    setRenaming(false);
    if (!run || !trimmed || trimmed === run.title) return;
    await onRenameRun(trimmed);
  };

  const cancelRename = () => {
    skipBlurCommitRef.current = true;
    setRenaming(false);
  };

  const runBusy = busy.has('create-new-run') || busy.has('rename-run') || busy.has('archive-run');

  return (
    <header className="om-scenario-header">
      <div className="om-scenario-header-lead">
        <div className="om-scenario-header-back">
          {breadcrumb ?? <BackToExploreButton onClick={onExplore} />}
        </div>

        <div className="om-scenario-header-identity">
          <span className="om-scenario-header-cover" aria-hidden="true">
            {coverSrc && !coverFailed ? (
              <img
                src={coverSrc}
                alt=""
                draggable={false}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <CoverPlaceholder fill />
            )}
          </span>
          <div className="om-scenario-header-titles">
            <div className="om-scenario-header-title-row">
              <h1 className="om-scenario-header-title">{t(scenario.title)}</h1>
              {category && (
                <span className="om-badge om-scenario-header-category">
                  <RemixIcon name={category.icon} size={12} />
                  <span>{t(category.label)}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="om-scenario-header-switcher">
          {renaming ? (
            <FieldInput
              ref={renameInputRef}
              density="compact"
              className="om-scenario-rename-input"
              aria-label={t('Rename run')}
              value={draftTitle}
              maxLength={120}
              onChange={event => setDraftTitle(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <Menu
              aria-label={t('Switch workflow run')}
              onOpenChange={open => {
                if (open) onLoadRuns();
              }}
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={runBusy}
                  className="om-scenario-run-button"
                  data-scenario-run-switcher=""
                >
                  <RemixIcon name="history-line" size={14} />
                  <span className="om-scenario-run-button-label">
                    {run ? run.title : t('New draft')}
                  </span>
                  <RemixIcon name="arrow-down-s-line" size={14} />
                </Button>
              }
            >
              {runsLoading ? (
                <MenuItem disabled>{t('Loading runs…')}</MenuItem>
              ) : runs.length === 0 ? (
                <MenuItem disabled>{t('No saved runs yet')}</MenuItem>
              ) : (
                runs.map(item => (
                  <MenuItem
                    key={item.id}
                    icon={
                      item.id === run?.id ? (
                        <RemixIcon name="check-line" size={14} />
                      ) : (
                        <RemixIcon name="route-line" size={14} />
                      )
                    }
                    shortcut={formatDate(item.updatedAt, { month: 'short', day: 'numeric' })}
                    onClick={() => onSelectRun(item.id)}
                  >
                    {item.title}
                  </MenuItem>
                ))
              )}
              <MenuSeparator />
              <MenuItem
                icon={<RemixIcon name="add-line" size={14} />}
                onClick={onNewRun}
              >
                {t('New run')}
              </MenuItem>
              <MenuItem
                icon={<RemixIcon name="edit-line" size={14} />}
                disabled={!run}
                onClick={beginRename}
              >
                {t('Rename run')}
              </MenuItem>
              <MenuItem
                icon={<RemixIcon name="delete-bin-line" size={14} />}
                tone="danger"
                disabled={!run}
                onClick={() => void onArchiveRun()}
              >
                {t('Archive run')}
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>

      <div className="om-scenario-header-actions">
        <IconButton
          variant="secondary"
          size="sm"
          type="button"
          className="om-scenario-pool-toggle"
          aria-label={t('Shared asset pool ({count})', { count: poolCount })}
          aria-expanded={poolOpen}
          aria-controls="om-scenario-pool"
          onClick={onTogglePool}
          icon={<RemixIcon name="side-bar-line" size={16} />}
        />

        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="om-scenario-desktop-action"
          icon={<RemixIcon name="robot-line" size={15} />}
          onClick={onCopyAgentHandoff}
        >
          {t('Copy Agent handoff')}
        </Button>

        <Button
          variant="primary"
          size="sm"
          type="button"
          className="om-scenario-export-cta"
          icon={<RemixIcon name="download-2-line" size={15} />}
          onClick={onExportBundle}
        >
          {t('Export bundle')}
        </Button>

        <div className="om-scenario-narrow-overflow">
          <Menu
            align="end"
            aria-label={t('Workflow actions')}
            trigger={
              <IconButton
                variant="secondary"
                size="sm"
                type="button"
                aria-label={t('More workflow actions')}
                icon={<RemixIcon name="more-2-line" size={16} />}
              />
            }
          >
            <MenuItem
              icon={<RemixIcon name="robot-line" size={14} />}
              onClick={onCopyAgentHandoff}
            >
              {t('Copy Agent handoff')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="download-2-line" size={14} />}
              onClick={onExportBundle}
            >
              {t('Export bundle')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<RemixIcon name="add-line" size={14} />}
              onClick={onNewRun}
            >
              {t('New run')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="edit-line" size={14} />}
              disabled={!run}
              onClick={beginRename}
            >
              {t('Rename run')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="delete-bin-line" size={14} />}
              tone="danger"
              disabled={!run}
              onClick={() => void onArchiveRun()}
            >
              {t('Archive run')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<RemixIcon name="apps-2-line" size={14} />}
              onClick={onOpenHub}
            >
              {t('All workflows')}
            </MenuItem>
          </Menu>
        </div>
      </div>
    </header>
  );
}
